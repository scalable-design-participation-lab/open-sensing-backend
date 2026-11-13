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
        scd_co2 = null
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
        await checkAndInsertModuleId(client, ModuleID, Lat, Lon, scd_co2);

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
        if (Local_Temp !== null) {
            await client.query(insertBlues, [ModuleID, Local_Temp, Voltage, ts]);
        }
        if (bmeTemperature !== null) {
            await client.query(insertBME, [ModuleID, bmeTemperature, bmeHumidity, bmePressure, ts]);
        }
        if (scd_temp !== null) {
            await client.query(insertSCD, [ModuleID, scd_temp, scd_humid, scd_co2, ts]);
        }
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
const checkAndInsertModuleId = async (client, moduleId, lat, lon, scd_co2) => {
    // Insert the module the first time it is seen. ON CONFLICT rather than
    // WHERE NOT EXISTS because the latter is not atomic: two uplinks from the
    // same new module can both pass the existence check, and the loser then
    // violates the ModuleId primary key, aborting the whole transaction and
    // losing that reading. rowCount is still 1 on insert and 0 on conflict,
    // so the caller below is unchanged.
    const queryText = `
        INSERT INTO Modules (ModuleId, lat, lon)
        VALUES ($1, $2, $3)
        ON CONFLICT (ModuleId) DO NOTHING;
    `;
    // Execute the query
    const res = await client.query(queryText, [moduleId, lat, lon]);
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
    }
};