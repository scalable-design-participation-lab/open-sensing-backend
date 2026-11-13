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
        releaseArgs: [], queries: [], rawQueries: [], params: [], errorListener: null,
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
                query: async (text, params) => {
                    const verb = String(text).trim().split(/\s+/)[0].toUpperCase();
                    state.queries.push(verb);
                    state.rawQueries.push(String(text));
                    state.params.push(params);
                    if (verb === "ROLLBACK" && options.failRollback) {
                        throw new Error("injected ROLLBACK failure");
                    }
                    if (verb === options.failOn) {
                        throw new Error("injected failure on " + verb);
                    }
                    const sql = String(text);
                    if (/SELECT\s+lat,\s*lon\s+FROM\s+Modules/i.test(sql)) {
                        const row = options.storedLocation;
                        return { rowCount: row ? 1 : 0, rows: row ? [row] : [] };
                    }
                    if (/INSERT INTO Modules/i.test(sql)) {
                        return { rowCount: options.moduleExists ? 0 : 1, rows: [] };
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
    describe("module location updates", () => {
        // uplink() reports timestamp 1762900000 (unix seconds)
        const UPLINK_TS = new Date(1762900000 * 1000);
        const findUpdate = (state) =>
            state.rawQueries.findIndex((q) => /UPDATE Modules SET lat/i.test(q));
        const findModuleInsert = (state) =>
            state.rawQueries.findIndex((q) => /INSERT INTO Modules/i.test(q));

        it("fills in a location when the module has none on record", async () => {
            const { handler, state } = loadApp({ moduleExists: true, storedLocation: { lat: null, lon: null } });
            await handler({ body: uplink({ Lat: 42.3398, Lon: -71.0892 }) }, fakeRes());

            const i = findUpdate(state);
            assert.notStrictEqual(i, -1, "an UPDATE should have been issued");
            assert.deepStrictEqual(state.params[i],
                ["864622040846236", 42.3398, -71.0892, UPLINK_TS]);
        });

        it("leaves the row alone when the module has barely moved", async () => {
            const { handler, state } = loadApp({ moduleExists: true, storedLocation: { lat: 42.3398, lon: -71.0892 } });
            // ~11 m north: inside GPS noise, below the 100 m threshold
            await handler({ body: uplink({ Lat: 42.3399, Lon: -71.0892 }) }, fakeRes());

            assert.strictEqual(findUpdate(state), -1, "jitter must not rewrite the row");
        });

        it("updates the row when the module has moved substantially", async () => {
            const { handler, state } = loadApp({ moduleExists: true, storedLocation: { lat: 42.3398, lon: -71.0892 } });
            // ~1.1 km north, well past the threshold
            await handler({ body: uplink({ Lat: 42.3498, Lon: -71.0892 }) }, fakeRes());

            const i = findUpdate(state);
            assert.notStrictEqual(i, -1, "a real relocation should update the row");
            assert.deepStrictEqual(state.params[i],
                ["864622040846236", 42.3498, -71.0892, UPLINK_TS]);
        });

        it("does not touch the row when the uplink carries no fix", async () => {
            const { handler, state } = loadApp({ moduleExists: true, storedLocation: { lat: 42.3398, lon: -71.0892 } });
            await handler({ body: uplink() }, fakeRes());

            assert.strictEqual(findUpdate(state), -1);
            assert.ok(!state.rawQueries.some((q) => /SELECT\s+lat,\s*lon/i.test(q)),
                "should not even read the stored location");
        });

        it("stamps Modules.timestamp when a new module arrives with a fix", async () => {
            const { handler, state } = loadApp({ moduleExists: false });
            await handler({ body: uplink({ Lat: 42.3398, Lon: -71.0892 }) }, fakeRes());

            const i = findModuleInsert(state);
            assert.deepStrictEqual(state.params[i],
                ["864622040846236", 42.3398, -71.0892, UPLINK_TS]);
        });

        it("leaves Modules.timestamp null when a new module has no fix", async () => {
            const { handler, state } = loadApp({ moduleExists: false });
            await handler({ body: uplink() }, fakeRes());

            const i = findModuleInsert(state);
            assert.strictEqual(state.params[i][3], null,
                "nothing has moved yet, so there is no move time to record");
        });

        it("does not update on the insert path, where lat/lon are already set", async () => {
            const { handler, state } = loadApp({ moduleExists: false });
            await handler({ body: uplink({ Lat: 42.3398, Lon: -71.0892 }) }, fakeRes());

            assert.ok(state.rawQueries.some((q) => /INSERT INTO Modules/i.test(q)));
            assert.strictEqual(findUpdate(state), -1, "the INSERT already carried the location");
        });
    });

    describe("fuel gauge and notecard", () => {
        const UPLINK_TS = new Date(1762900000 * 1000);
        const find = (state, table) =>
            state.rawQueries.findIndex((q) =>
                new RegExp("INSERT INTO " + table + "\\b", "i").test(q));

        it("writes a fuel gauge reading to stemma_fuel_gauge", async () => {
            const { handler, state } = loadApp();
            await handler({ body: uplink({
                fuelgage_temp: 24.5, fuelgage_voltage: 3.92, fuelgage_percent: 87,
            }) }, fakeRes());

            const i = find(state, "stemma_fuel_gauge");
            assert.notStrictEqual(i, -1, "stemma_fuel_gauge row should be written");
            assert.deepStrictEqual(state.params[i],
                ["864622040846236", 24.5, 3.92, 87, UPLINK_TS]);
        });

        it("writes the reading even when only one of the three is present", async () => {
            const { handler, state } = loadApp();
            await handler({ body: uplink({ fuelgage_percent: 87 }) }, fakeRes());

            const i = find(state, "stemma_fuel_gauge");
            assert.notStrictEqual(i, -1, "a partial reading is still a reading");
            assert.deepStrictEqual(state.params[i],
                ["864622040846236", null, null, 87, UPLINK_TS]);
        });

        it("writes nothing when the uplink carries no fuel gauge data", async () => {
            const { handler, state } = loadApp();
            await handler({ body: uplink() }, fakeRes());

            assert.strictEqual(find(state, "stemma_fuel_gauge"), -1);
        });

        it("reaches Blues_Notecard on voltage alone", async () => {
            const { handler, state } = loadApp();
            // this firmware sends lowercase voltage and no Local_Temp
            await handler({ body: uplink({ voltage: 4.01 }) }, fakeRes());

            const i = find(state, "Blues_Notecard");
            assert.notStrictEqual(i, -1, "voltage alone should reach the table");
            assert.deepStrictEqual(state.params[i],
                ["864622040846236", null, 4.01, UPLINK_TS]);
        });

        it("still honours the older Local_Temp/Voltage firmware", async () => {
            const { handler, state } = loadApp();
            await handler({ body: uplink({ Local_Temp: 19.2, Voltage: 3.7 }) }, fakeRes());

            const i = find(state, "Blues_Notecard");
            assert.notStrictEqual(i, -1);
            assert.deepStrictEqual(state.params[i],
                ["864622040846236", 19.2, 3.7, UPLINK_TS]);
        });

        it("prefers the lowercase voltage when both keys arrive", async () => {
            const { handler, state } = loadApp();
            await handler({ body: uplink({ Local_Temp: 19.2, Voltage: 3.7, voltage: 4.01 }) }, fakeRes());

            const i = find(state, "Blues_Notecard");
            assert.strictEqual(state.params[i][2], 4.01);
        });

        it("leaves Blues_Notecard alone when neither field arrives", async () => {
            const { handler, state } = loadApp();
            await handler({ body: uplink() }, fakeRes());

            assert.strictEqual(find(state, "Blues_Notecard"), -1);
        });
    });

    describe("distance and coordinate helpers", () => {
        const { distanceMetres, asCoordinate } = require("../pushUpLink.js");

        it("measures great-circle distance against known references", () => {
            const near = (got, expect, tol) => assert.ok(
                Math.abs(got - expect) <= tol,
                "got " + got + ", expected ~" + expect + " (+/-" + tol + ")");

            near(distanceMetres(42.3601, -71.0589, 40.7128, -74.0060), 306000, 3000); // Boston->NYC
            near(distanceMetres(0, 0, 1, 0), 111195, 300);   // 1 deg latitude
            near(distanceMetres(60, 0, 60, 1), 55597, 300);  // 1 deg longitude at 60N
            near(distanceMetres(42.34, -71.09, 42.34, -71.09), 0, 0.001);
        });

        it("reads the same metres at every deployment latitude", () => {
            // Modules are deployed from Boston down to Mexico City. A degree of
            // longitude shrinks with latitude, so a threshold expressed in
            // degrees would mean a different real distance in each city. These
            // assert that a true 100 m displacement measures 100 m everywhere.
            const R = 6371008.8;
            const toRad = (d) => (d * Math.PI) / 180;
            const cities = [
                ["Boston, MA", 42.3601, -71.0589],
                ["Oakland, CA", 37.8044, -122.2712],
                ["Monterrey, MX", 25.6866, -100.3161],
                ["Mexico City, MX", 19.4326, -99.1332],
            ];

            for (const [name, lat, lon] of cities) {
                const dLat = ((100 / R) * 180) / Math.PI;
                const dLon = ((100 / (R * Math.cos(toRad(lat)))) * 180) / Math.PI;

                const north = distanceMetres(lat, lon, lat + dLat, lon);
                const east = distanceMetres(lat, lon, lat, lon + dLon);

                assert.ok(Math.abs(north - 100) < 0.1, name + " north: " + north);
                assert.ok(Math.abs(east - 100) < 0.1, name + " east: " + east);
            }
        });

        it("rejects null but accepts a genuine zero", () => {
            // Number(null) is 0, which is finite — the guard must not read a
            // missing coordinate as a point on the equator.
            assert.strictEqual(asCoordinate(null, 90), null);
            assert.strictEqual(asCoordinate(undefined, 90), null);
            assert.strictEqual(asCoordinate("", 90), null);
            assert.strictEqual(asCoordinate("abc", 90), null);
            assert.strictEqual(asCoordinate(0, 90), 0);
            assert.strictEqual(asCoordinate("42.34", 90), 42.34);
        });

        it("rejects out-of-range coordinates", () => {
            assert.strictEqual(asCoordinate(91, 90), null);
            assert.strictEqual(asCoordinate(-91, 90), null);
            assert.strictEqual(asCoordinate(181, 180), null);
            assert.strictEqual(asCoordinate(-180, 180), -180);
        });
    });
});
