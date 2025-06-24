const functions = require('@google-cloud/functions-framework');
const pg = require("pg");

functions.http('helloHttp', async(req, res) => {
  if(req.body) console.log('body is: ',req.body, 'temperature...', req.body.Temperature)
  // console.log('I am a log entry!');
  // console.error('I am an error!');
  // res.send(`Hello ${req.body.name}, bodyyyyyy=${JSON.stringify(req.body)}!`);
 if(req.body) {
    const credentials = {
        host: process.env.host,
        database: process.env.database,
        port:"5432",
        user:"postgres",
        password: process.env.password
    }        
    
    const pool = new pg.Pool(credentials); //new Pool(credentials);

    // Insert a test row into the Sensor table
        const insertSen55 = 'INSERT INTO SEN55(ModuleID, Temperature, Relative_Humidity, VOC, NOx, PM1, PM25, PM4, PM10, timestamp) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)'
        const insertSoil = 'INSERT INTO Soil(ModuleID, Soil_Moisture, timestamp) VALUES ($1, $2, $3)'
        const insertCurrent_Sensor = 'INSERT INTO Current_Sensor(ModuleID, Solar_Input_Current, timestamp) VALUES ($1, $2, $3)'
        const insertMicrocontroller = 'INSERT INTO Microcontroller(ModuleID, Battery_Level, timestamp) VALUES ($1, $2, $3)'
        const insertGPS = 'INSERT INTO GPS(ModuleID, Lat, Lon, timestamp) VALUES ($1, $2, $3, $4)'
        const insertBlues = 'INSERT INTO Blues_Notecard(ModuleID, temperature, voltage, timestamp) VALUES ($1, $2, $3, $4)'
        const insertBME = 'INSERT INTO bme_280(ModuleID, bme_temp, bme_humid, bme_pressure, timestamp) VALUES ($1, $2, $3, $4, $5)'
        const insertSCD = 'INSERT INTO scd_41(ModuleID, scd_temp, scd_humid, scd_co2, timestamp) VALUES ($1, $2, $3, $4, $5)'

        const str = req.body.ID;
        const parts = str.split(':');
        const integerPart = parts[1];

        const ModuleID = integerPart !== undefined ? integerPart : null;
        const Temperature = req.body.Temperature !== undefined ? req.body.Temperature : null;
        const Relative_Humidity = req.body.Relative_Humidity !== undefined ? req.body.Relative_Humidity : null;
        const VOC = req.body['VOC'] !== undefined ? req.body['VOC'] : null;
        const NOx = req.body['NOx'] !== undefined ? req.body['NOx'] : null;


        const PM1 = req.body.PM1 !== undefined ? req.body.PM1 : null;
        const PM25 = req.body.PM25 !== undefined ? req.body.PM25 : null;
        const PM4 = req.body.PM4 !== undefined ? req.body.PM4 : null;
        const PM10 = req.body.PM10 !== undefined ? req.body.PM10 : null;
        const Soil_Moisture = req.body.Soil_Moisture !== undefined ? req.body.Soil_Moisture : null;
        const Solar_Input_Current = req.body.Solar_Input_Current !== undefined ? req.body.Solar_Input_Current : null;
        const Battery_Level = req.body.Battery_Level !== undefined ? req.body.Battery_Level : null;
        const Lat = req.body.Lat !== undefined ? req.body.Lat : null;
        const Lon = req.body.Lon !== undefined ? req.body.Lon : null;
        const Local_Temp = req.body.Local_Temp !== undefined ? req.body.Local_Temp : null
        const Voltage = req.body.Voltage !== undefined ? req.body.Voltage : null
        const timestamp = req.body.timestamp !== undefined || req.body.timestamp !== 0 ? new Date(req.body.timestamp * 1000) : new Date();

        const bme_temp = req.body['bmeTemperature'] !== undefined ? req.body['bmeTemperature'] : null
        const bme_humid = req.body['bmeHumidity'] !== undefined ? req.body['bmeHumidity'] : null
        const bme_pressure = req.body['bmePressure'] !== undefined ? req.body['bmePressure'] : null

        const scd_temp = req.body['scd_temp'] !== undefined ? req.body['scd_temp'] : null
        const scd_humid = req.body['scd_humid'] !== undefined ? req.body['scd_humid'] : null
        const scd_co2 = req.body['scd_co2'] !== undefined ? req.body['scd_co2'] : null


        checkAndInsertModuleId(pool, ModuleID);

        // const insert = await pool.query(insertText, ['f9e87ab8-2a57-11ee-be56-0242ac120002', 'Soil', 'Howard', 1, 40.6722, 73.9078, now])
        if (Temperature !== null ) {
            const runInsertSen55 = pool.query(insertSen55, [ModuleID, Temperature, Relative_Humidity, VOC, NOx, PM1, PM25, PM4, PM10, timestamp]).then(res => {console.log(res)}).catch(err => {console.log(err)})
        }
        // if (Soil_Moisture !== null ) {
        //     const runInsertSoil = pool.query(insertSoil, [ModuleID, Soil_Moisture, timestamp])
        // }
        // if (Solar_Input_Current !== null ) {
        //     const runInsertCurrent_Sensor = pool.query(insertCurrent_Sensor, [ModuleID, Solar_Input_Current, timestamp])
        // }
        // if (Battery_Level !== null ) {
        //     const runInsertMicrocontroller = pool.query(insertMicrocontroller, [ModuleID, Battery_Level, timestamp])
        // }
        // if (Lat !== null ) {
        //     const runInsertGPS = pool.query(insertGPS, [ModuleID, Lat, Lon, timestamp])
        // }
        // if (Local_Temp !== null ) {
        //     const runInsertBlues = pool.query(insertBlues, [ModuleID, Local_Temp, Voltage, timestamp])
        // }
        if (bme_temp !== null ) {
            const runInsertBME = pool.query(insertBME, [ModuleID, bme_temp, bme_humid, bme_pressure, timestamp])
        }

        if (scd_temp !== null ) {
            const runInsertSCD = pool.query(insertSCD, [ModuleID, scd_temp, scd_humid, scd_co2, timestamp])
        }

    }
  
});


// Function to check if ModuleId exists and insert if it doesn't
const checkAndInsertModuleId = async (client, moduleId) => {

    // SQL query that checks if the ModuleId exists, and inserts it if it doesn't
    const queryText = `
        INSERT INTO Modules (ModuleId)
        SELECT $1
        WHERE NOT EXISTS (
            SELECT 1 FROM Modules WHERE ModuleId = $1
        );
    `;

    // Execute the query
    const res = await client.query(queryText, [moduleId]);
    if (res.rowCount > 0) {
        console.log(`ModuleId ${moduleId} inserted.`);
    } else {
        console.log(`ModuleId ${moduleId} already exists.`);
    }
};
