const functions = require('@google-cloud/functions-framework');
const moment = require('moment-timezone');
const { Pool } = require('pg');

functions.http('helloHttp', async (req, res) => {
    if (!req.body) {
        return res.status(400).send('No data provided');
    }

    // Configure your PostgreSQL connection
    const pool = new Pool({
        host: process.env.host,
        database: process.env.database,
        port:"5432",
        user:"postgres",
        password: process.env.password
    });

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

    const str = req.body.ID;
    const parts = str.split(':');
    const integerPart = parts[1];

    const ModuleID = integerPart !== undefined ? integerPart : null;

    // Use EST time zone for timestamp if not provided
    const ts = (timestamp !== undefined && timestamp !== 0)
        ? new Date(timestamp * 1000)
        : moment().tz("America/New_York").toDate();

    // Prepare insert queries and params
    const queries = [];

    if (Temperature !== undefined && Temperature !== null) {
        queries.push(pool.query(insertSen55, [
            ModuleID, Temperature, Relative_Humidity, VOC, NOx, PM1, PM25, PM4, PM10, ts
        ]));
    }
    if (Soil_Moisture !== undefined && Soil_Moisture !== null) {
        queries.push(pool.query(insertSoil, [ModuleID, Soil_Moisture, ts]));
    }
    if (Solar_Input_Current !== undefined && Solar_Input_Current !== null) {
        queries.push(pool.query(insertCurrent_Sensor, [ModuleID, Solar_Input_Current, ts]));
    }
    if (Battery_Level !== undefined && Battery_Level !== null) {
        queries.push(pool.query(insertMicrocontroller, [ModuleID, Battery_Level, ts]));
    }
    if (Lat !== undefined && Lat !== null) {
        queries.push(pool.query(insertGPS, [ModuleID, Lat, Lon, ts]));
    }
    if (Local_Temp !== undefined && Local_Temp !== null) {
        queries.push(pool.query(insertBlues, [ModuleID, Local_Temp, Voltage, ts]));
    }
    if (bmeTemperature !== undefined && bmeTemperature !== null) {
        queries.push(pool.query(insertBME, [ModuleID, bmeTemperature, bmeHumidity, bmePressure, ts]));
    }
    if (scd_temp !== undefined && scd_temp !== null) {
        queries.push(pool.query(insertSCD, [ModuleID, scd_temp, scd_humid, scd_co2, ts]));
    }

    if (queries.length === 0) {
        return res.status(400).send('No valid sensor data to insert');
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        // Only check/insert ModuleID if we have sensor data to insert
        await checkAndInsertModuleId(client, ModuleID);
        await Promise.all(queries);
        await client.query('COMMIT');
        res.status(200).send('Data inserted successfully');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        res.status(500).send('Database error');
    } finally {
        client.release();
    }
});

// Function to check if ModuleId exists and insert if it doesn't
const checkAndInsertModuleId = async (client, moduleId) => {
    const queryText = `
        INSERT INTO Modules (ModuleId)
        SELECT $1
        WHERE NOT EXISTS (
            SELECT 1 FROM Modules WHERE ModuleId = $1
        );
    `;
    await client.query(queryText, [moduleId]);
};