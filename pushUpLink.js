const functions = require('@google-cloud/functions-framework');
const pg = require("pg");

const credentials = {
    host: process.env.host,
    database: process.env.database,
    port: "5432",
    user: "postgres",
    password: process.env.password
};

// One pool per function instance, reused across invocations. Building a pool
// inside the handler meant it was never ended, so every uplink left a
// connection idle for pg's idleTimeoutMillis (30s) and the number of open
// connections tracked the uplink rate rather than the instance count.
const pool = new pg.Pool(credentials);

// An idle client that fails emits 'error' on the pool, not on a query. On a
// pool that outlives the request there is no surrounding try/catch to reach,
// so without this listener it would be an unhandled error event and would
// terminate the instance.
pool.on('error', (err) => {
    console.error('Unexpected error on idle Postgres client', err);
});

// How far a module must move, in metres, before its stored location is
// rewritten. GPS noise on a stationary module is routinely a few tens of
// metres, so the default sits well above that: without a floor the row would
// be rewritten on jitter every time a module reports.
const LOCATION_UPDATE_THRESHOLD_M =
    Number(process.env.location_update_threshold_m) > 0
        ? Number(process.env.location_update_threshold_m)
        : 100;

// Great-circle distance in metres between two points (haversine).
const distanceMetres = (lat1, lon1, lat2, lon2) => {
    const R = 6371008.8; // IUGG mean Earth radius
    const toRad = (deg) => (deg * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
};

// null/undefined are rejected before the numeric check because Number(null)
// is 0, which is finite and would read as a coordinate on the equator.
const asCoordinate = (value, limit) => {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    if (!Number.isFinite(n) || Math.abs(n) > limit) return null;
    return n;
};

functions.http('helloHttp', async (req, res) => {
    if (!req.body) {
        return res.status(400).send('No data provided');
    }

    // Insert statements
    const insertSen55 = 'INSERT INTO SEN55(ModuleID, Temperature, Relative_Humidity, VOC, NOx, PM1, PM25, PM4, PM10, timestamp) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)';
    const insertSoil = 'INSERT INTO Soil(ModuleID, Soil_Moisture, timestamp) VALUES ($1, $2, $3)';
    const insertCurrent_Sensor = 'INSERT INTO Current_Sensor(ModuleID, Solar_Input_Current, timestamp) VALUES ($1, $2, $3)';
    const insertMicrocontroller = 'INSERT INTO Microcontroller(ModuleID, Battery_Level, timestamp) VALUES ($1, $2, $3)';
    const insertGPS = 'INSERT INTO GPS(ModuleID, Lat, Lon, timestamp) VALUES ($1, $2, $3, $4)';
    const insertBlues = 'INSERT INTO Blues_Notecard(ModuleID, temperature, voltage, timestamp) VALUES ($1, $2, $3, $4)';
    const insertBME = 'INSERT INTO bme_280(ModuleID, bme_temp, bme_humid, bme_pressure, timestamp) VALUES ($1, $2, $3, $4, $5)';
    const insertSCD = 'INSERT INTO scd_41(ModuleID, scd_temp, scd_humid, scd_co2, timestamp) VALUES ($1, $2, $3, $4, $5)';

    // Parse ModuleID from req.body.ID
    let ModuleID = null;
    if (req.body.ID) {
        const parts = req.body.ID.split(':');
        ModuleID = parts[1] !== undefined ? parts[1] : null;
    }

    // Destructure with null defaults
    const {
        Temperature = null,
        Relative_Humidity = null,
        VOC = null,
        NOx = null,
        PM1 = null,
        PM25 = null,
        PM4 = null,
        PM10 = null,
        Soil_Moisture = null,
        Solar_Input_Current = null,
        Battery_Level = null,
        Lat = null,
        Lon = null,
        Local_Temp = null,
        Voltage = null,
        timestamp = null,
        bmeTemperature = null,
        bmeHumidity = null,
        bmePressure = null,
        scd_temp = null,
        scd_humid = null,
        scd_co2 = null,

        // Fields the uplink payload carries that were not being read. They are
        // captured here so the data is no longer silently dropped at the door;
        // none of them is written to a table yet.

        // Fuel gauge / battery telemetry. The payload's "fuelgage" spelling is
        // kept here because that is the key the firmware sends; the columns it
        // maps to are spelled "fuel_gauge".
        fuelgage_temp = null,
        fuelgage_voltage = null,
        fuelgage_percent = null,

        // The payload sends lowercase `voltage`. `Voltage` above is the key an
        // older firmware sends, and is kept as a fallback below.
        voltage = null,

        // Blues routing times. Read but not written to any table — kept here
        // so the handler's view of the payload stays complete, and so storing
        // them later is a one-line change rather than a rediscovery.
        inboundTime = null,
        outboundTime = null
    } = req.body;

    // Use the provided unix timestamp (seconds) when it is usable,
    // otherwise fall back to the time the uplink was received.
    const providedTs = Number(timestamp);
    const ts = (Number.isFinite(providedTs) && providedTs !== 0)
        ? new Date(providedTs * 1000)
        : new Date();

    // Only proceed if ModuleID is present
    if (!ModuleID) {
        return res.status(400).send('ModuleID is required');
    }

    // Set when the transaction could not be rolled back, so the client is
    // discarded instead of returned to the pool.
    let discardClient = false;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await checkAndInsertModuleId(client, ModuleID, Lat, Lon, scd_co2, ts);

        // Insert sensor data if present
        if (Temperature !== null) {
            await client.query(insertSen55, [ModuleID, Temperature, Relative_Humidity, VOC, NOx, PM1, PM25, PM4, PM10, ts]);
        }
        if (Soil_Moisture !== null) {
            await client.query(insertSoil, [ModuleID, Soil_Moisture, ts]);
        }
        if (Solar_Input_Current !== null) {
            await client.query(insertCurrent_Sensor, [ModuleID, Solar_Input_Current, ts]);
        }
        if (Battery_Level !== null) {
            await client.query(insertMicrocontroller, [ModuleID, Battery_Level, ts]);
        }
        if (Lat !== null) {
            await client.query(insertGPS, [ModuleID, Lat, Lon, ts]);
        }
        // Either field alone is worth a row. Gating on Local_Temp alone meant
        // firmware that reports voltage without it never reached this table.
        if (Local_Temp !== null || voltage !== null) {
            await client.query(insertBlues, [ModuleID, Local_Temp, voltage ?? Voltage, ts]);
        }
        if (bmeTemperature !== null) {
            await client.query(insertBME, [ModuleID, bmeTemperature, bmeHumidity, bmePressure, ts]);
        }
        if (scd_temp !== null) {
            await client.query(insertSCD, [ModuleID, scd_temp, scd_humid, scd_co2, ts]);
        }
        await insertFuelGaugeReading(client, ModuleID, {
            temp: fuelgage_temp,
            voltage: fuelgage_voltage,
            percent: fuelgage_percent,
        }, ts);
        console.log(`Data inserted for ModuleID: ${ModuleID} at ${ts}`);

        await client.query('COMMIT');
        res.status(200).send('Data inserted successfully');
    } catch (err) {
        // Log before rolling back. If the ROLLBACK also fails this is the only
        // place the original error is recorded.
        console.error('Uplink insert failed', err);

        try {
            await client.query('ROLLBACK');
        } catch (rollbackErr) {
            discardClient = true;
            console.error('ROLLBACK failed; discarding the connection', rollbackErr);
        }

        res.status(500).send('Database error');
    } finally {
        // A client whose ROLLBACK did not go through may still hold an open
        // transaction. A truthy argument removes it from the pool rather than
        // returning it, so a later request cannot inherit that state.
        client.release(discardClient);
    }
});

// Function to check if ModuleId exists and insert if it doesn't
const checkAndInsertModuleId = async (client, moduleId, lat, lon, scd_co2, ts) => {
    // Insert the module the first time it is seen. ON CONFLICT rather than
    // WHERE NOT EXISTS because the latter is not atomic: two uplinks from the
    // same new module can both pass the existence check, and the loser then
    // violates the ModuleId primary key, aborting the whole transaction and
    // losing that reading. rowCount is still 1 on insert and 0 on conflict,
    // so the caller below is unchanged.
    // Modules.timestamp records when the stored location was last
    // established, so it is only set when this uplink actually carried a fix.
    // A module registered without one keeps a NULL timestamp until its first
    // real position arrives, which the update path below then stamps.
    const hasFix = asCoordinate(lat, 90) !== null && asCoordinate(lon, 180) !== null;
    const queryText = `
        INSERT INTO Modules (ModuleId, lat, lon, timestamp)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (ModuleId) DO NOTHING;
    `;
    // Execute the query
    const res = await client.query(queryText, [moduleId, lat, lon, hasFix ? ts : null]);
    if (res.rowCount > 0) {
        console.log(`ModuleId ${moduleId} inserted.`);

        // Determine sensors array based on scd_co2
        let sensors;
        if (scd_co2 !== null) {
            sensors = ['sen55', 'scd_41'];
        } else {
            sensors = ['sen55', 'bme_280'];
        }


        // Insert into modulesensors
        await client.query(
            'INSERT INTO modulesensors (moduleid, sensors) VALUES ($1, $2);',
            [moduleId, sensors]
        );
        console.log(`Inserted into modulesensors: moduleid=${moduleId}, inserted with Lat=${lat}, Lon=${lon}, sensors=${JSON.stringify(sensors)}`);
    } else {
        console.log(`ModuleId ${moduleId} already exists.`);
        await updateModuleLocation(client, moduleId, lat, lon, ts);
    }
};

// Keep Modules.lat/lon pointing at where the module actually is. The GPS table
// already keeps every reported fix; this is the current canonical position, and
// before this it was written once at first sighting and never revisited, so a
// relocated module kept reporting under its original coordinates forever.
const updateModuleLocation = async (client, moduleId, lat, lon, ts) => {
    const newLat = asCoordinate(lat, 90);
    const newLon = asCoordinate(lon, 180);
    if (newLat === null || newLon === null) {
        return; // this uplink carried no usable fix
    }

    const { rows } = await client.query(
        'SELECT lat, lon FROM Modules WHERE ModuleId = $1',
        [moduleId]
    );
    if (rows.length === 0) {
        return;
    }

    const storedLat = asCoordinate(rows[0].lat, 90);
    const storedLon = asCoordinate(rows[0].lon, 180);

    let reason;
    if (storedLat === null || storedLon === null) {
        // Registered before it had a fix, or stored garbage. Fill it in.
        reason = 'no location on record';
    } else {
        const moved = distanceMetres(storedLat, storedLon, newLat, newLon);
        if (moved < LOCATION_UPDATE_THRESHOLD_M) {
            return; // within noise, leave the row alone
        }
        reason = `moved ${Math.round(moved)}m`;
    }

    // timestamp travels with lat/lon so the column always means "when the
    // stored location was last set" rather than drifting out of step with it.
    await client.query(
        'UPDATE Modules SET lat = $2, lon = $3, timestamp = $4 WHERE ModuleId = $1',
        [moduleId, newLat, newLon, ts]
    );
    console.log(
        `ModuleId ${moduleId} location updated (${reason}): ${newLat}, ${newLon} at ${ts}`
    );
};

const INSERT_FUEL_GAUGE =
    'INSERT INTO stemma_fuel_gauge'
    + '(ModuleID, fuel_gauge_temp, fuel_gauge_voltage, fuel_gauge_percent, timestamp) '
    + 'VALUES ($1, $2, $3, $4, $5)';

// Write a fuel gauge reading, when this uplink carried one. The table is
// created by migrations/002_create_stemma_fuel_gauge.sql.
//
// The payload spells it "fuelgage"; the columns spell it "fuel_gauge". The
// firmware's typo is fixed in the wire format and not worth breaking devices
// over, but it stops at this boundary rather than being written into every
// query anyone runs against the table. That is what this mapping is for.
//
// The three readings are independent — a gauge can report state of charge
// without temperature — so the row goes in whenever any of them is present,
// with the absent ones as NULL. Gating on a single field, as the sensor
// inserts above do, would drop the other two whenever that one was missing.
const insertFuelGaugeReading = async (client, moduleId, reading, ts) => {
    const { temp, voltage, percent } = reading;
    if (temp === null && voltage === null && percent === null) {
        return;
    }
    await client.query(INSERT_FUEL_GAUGE, [moduleId, temp, voltage, percent, ts]);
};

// Exported for tests; the deployed function is reached through the registration
// above, not through these.
module.exports = {
    distanceMetres,
    asCoordinate,
    insertFuelGaugeReading,
    LOCATION_UPDATE_THRESHOLD_M,
};