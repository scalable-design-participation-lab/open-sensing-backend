const functions = require('@google-cloud/functions-framework');
const pg = require("pg");

functions.http('helloHttp', async (req, res) => {
    if (!req.body) {
        return res.status(400).send('No data provided');
    }

    const credentials = {
        host: process.env.host,
        database: process.env.database,
        port: "5432",
        user: "postgres",
        password: process.env.password
    };

    const pool = new pg.Pool(credentials);

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

    // Use provided timestamp or current time
    const ts = (timestamp !== null && timestamp !== 0)
        ? new Date(timestamp * 1000)
        : new Date();

    // Only proceed if ModuleID is present
    if (!ModuleID) {
        return res.status(400).send('ModuleID is required');
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await checkAndInsertModuleId(client, ModuleID, Lat, Lon);

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

// Function to check if ModuleId exists and insert if it doesn't, now also inserts Lat and Lon
const checkAndInsertModuleId = async (client, moduleId, lat = null, lon = null) => {
    // Try to insert with lat/lon if not exists
    const queryText = `
        INSERT INTO Modules (ModuleId, lat, lon)
        SELECT $1, $2, $3
        WHERE NOT EXISTS (
            SELECT 1 FROM Modules WHERE ModuleId = $1
        );
    `;
    const res = await client.query(queryText, [moduleId, lat, lon]);
    if (res.rowCount > 0) {
        console.log(`ModuleId ${moduleId} inserted with Lat=${lat}, Lon=${lon}.`);
    } else {
        console.log(`ModuleId ${moduleId} already exists.`);
    }
};