const assert = require('node:assert');

const PG = require.resolve('pg');
const FF = require.resolve('@google-cloud/functions-framework');
const APP = require.resolve('../pushUpLink.js');

// Load pushUpLink.js against stubbed pg / functions-framework so the handler
// can be driven without a Postgres instance. Returns the registered handler
// plus the counters the stubs record.
function loadApp(options = {}) {
    const state = {
        poolsConstructed: 0, connects: 0, releases: 0,
        releaseArgs: [], queries: [], rawQueries: [], errorListener: null,
    };

    class FakePool {
        constructor(config) {
            state.poolsConstructed++;
            state.config = config;
        }
        on(event, fn) {
            if (event === 'error') state.errorListener = fn;
        }
        async connect() {
            state.connects++;
            return {
                query: async (text) => {
                    const verb = String(text).trim().split(/\s+/)[0].toUpperCase();
                    state.queries.push(verb);
                    state.rawQueries.push(String(text));
                    if (verb === "ROLLBACK" && options.failRollback) {
                        throw new Error("injected ROLLBACK failure");
                    }
                    if (verb === options.failOn) {
                        throw new Error("injected failure on " + verb);
                    }
                    return { rowCount: options.rowCount ?? 1, rows: [] };
                },
                release: (arg) => { state.releases++; state.releaseArgs.push(arg); },
            };
        }
    }

    let handler;
    const stub = (p, exports) => { require.cache[p] = { id: p, filename: p, loaded: true, exports }; };
    stub(PG, { Pool: FakePool });
    stub(FF, { http: (_name, fn) => { handler = fn; } });
    delete require.cache[APP];
    require(APP);
    delete require.cache[PG];
    delete require.cache[FF];

    return { handler, state };
}

function fakeRes() {
    const res = {
        statusCode: null,
        body: null,
        status(code) { res.statusCode = code; return res; },
        send(body) { res.body = body; return res; },
    };
    return res;
}

const uplink = (over = {}) => ({
    ID: 'imei:864622040846236',
    Temperature: 21.5,
    Relative_Humidity: 48,
    timestamp: 1762900000,
    ...over,
});

describe('pushUpLink connection handling', () => {
    it('builds one pool per instance, not one per request', async () => {
        const { handler, state } = loadApp();
        assert.strictEqual(state.poolsConstructed, 1, 'pool should be built at module load');

        for (let i = 0; i < 5; i++) {
            await handler({ body: uplink() }, fakeRes());
        }

        assert.strictEqual(state.poolsConstructed, 1, 'no further pools across 5 requests');
        assert.strictEqual(state.connects, 5, 'each request still takes a client');
        assert.strictEqual(state.releases, 5, 'each request still releases its client');
    });

    it('registers a pool error listener so an idle client cannot crash the instance', () => {
        const { state } = loadApp();
        assert.strictEqual(typeof state.errorListener, 'function');
        assert.doesNotThrow(() => state.errorListener(new Error('idle client died')));
    });

    it('reads connection settings from the environment', () => {
        const { state } = loadApp();
        assert.deepStrictEqual(Object.keys(state.config).sort(),
            ['database', 'host', 'password', 'port', 'user']);
    });

    it('still wraps each uplink in a transaction', async () => {
        const { handler, state } = loadApp();
        const res = fakeRes();
        await handler({ body: uplink() }, res);

        assert.strictEqual(state.queries[0], 'BEGIN');
        assert.strictEqual(state.queries.at(-1), 'COMMIT');
        assert.strictEqual(res.statusCode, 200);
    });

    it('inserts a new module atomically rather than checking then inserting', async () => {
        const { handler, state } = loadApp();
        await handler({ body: uplink() }, fakeRes());

        const moduleInsert = state.rawQueries.find((q) => /INSERT INTO Modules/i.test(q));
        assert.ok(moduleInsert, 'the module insert should still run');
        assert.match(moduleInsert, /ON CONFLICT\s*\(\s*ModuleId\s*\)\s*DO NOTHING/i);
        assert.doesNotMatch(moduleInsert, /WHERE NOT EXISTS/i,
            'check-then-insert races a concurrent uplink from the same new module');
    });

    it('rejects an uplink with no ModuleID without taking a client', async () => {
        const { handler, state } = loadApp();
        const res = fakeRes();
        await handler({ body: { Temperature: 20 } }, res);

        assert.strictEqual(res.statusCode, 400);
        assert.strictEqual(state.connects, 0, 'must not reach the pool');
    });
    describe("when the transaction fails", () => {
        it("still answers 500 even if the ROLLBACK also fails", async () => {
            const { handler } = loadApp({ failOn: "INSERT", failRollback: true });
            const res = fakeRes();

            await handler({ body: uplink() }, res);

            assert.strictEqual(res.statusCode, 500);
            assert.strictEqual(res.body, "Database error");
        });

        it("discards the client when the ROLLBACK fails", async () => {
            const { handler, state } = loadApp({ failOn: "INSERT", failRollback: true });
            await handler({ body: uplink() }, fakeRes());

            assert.strictEqual(state.releases, 1);
            assert.ok(state.releaseArgs[0], "release() must get a truthy arg so pg drops the client");
        });

        it("returns the client to the pool when the ROLLBACK succeeds", async () => {
            const { handler, state } = loadApp({ failOn: "INSERT" });
            const res = fakeRes();

            await handler({ body: uplink() }, res);

            assert.strictEqual(res.statusCode, 500);
            assert.ok(state.queries.includes("ROLLBACK"));
            assert.ok(!state.releaseArgs[0], "a cleanly rolled back client is reusable");
        });
    });
});
