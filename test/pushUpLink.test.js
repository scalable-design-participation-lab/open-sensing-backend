const assert = require('node:assert');

const PG = require.resolve('pg');
const FF = require.resolve('@google-cloud/functions-framework');
const APP = require.resolve('../pushUpLink.js');

// Load pushUpLink.js against stubbed pg / functions-framework so the handler
// can be driven without a Postgres instance. Returns the registered handler
// plus the counters the stubs record.
function loadApp() {
    const state = { poolsConstructed: 0, connects: 0, releases: 0, queries: [], errorListener: null };

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
                    state.queries.push(String(text).trim().split(/\s+/)[0].toUpperCase());
                    return { rowCount: 1, rows: [] };
                },
                release: () => { state.releases++; },
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

    it('rejects an uplink with no ModuleID without taking a client', async () => {
        const { handler, state } = loadApp();
        const res = fakeRes();
        await handler({ body: { Temperature: 20 } }, res);

        assert.strictEqual(res.statusCode, 400);
        assert.strictEqual(state.connects, 0, 'must not reach the pool');
    });
});
