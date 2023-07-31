const functions = require('@google-cloud/functions-framework');
const pg = require("pg");

functions.http('helloHttp', async(req, res) => {
    if(req.body) {
        const credentials = {
            host: process.env.host,
            database: process.env.database,
            port:"5432",
            user:"postgres",
            password: process.env.password
        }        
        
        // const pool = new Pool(credentials);
        const pool = new pg.Pool(credentials); //new Pool(credentials);

        // Insert a test row into the Sensor table
        const insertSensor = 'INSERT INTO Modules(ModuleID, EcoHub_Location, EcoHub_ID, Lat, Lon, timestamp) VALUES ($1, $2, $3, $4, $5, $6, $7)'
        const insertSen55 = 'INSERT INTO SEN55(ModuleID, Temperature, Relative_Humidity, VOC, NOx, PM1, PM25, PM4, PM10, timestamp) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)'
        const insertSoil = 'INSERT INTO Soil(ModuleID, Soil_Moisture, timestamp) VALUES ($1, $2, $3)'
        const insertCurrent_Sensor = 'INSERT INTO Current_Sensor(ModuleID, Solar_Input_Current, timestamp) VALUES ($1, $2, $3)'
        const insertMicrocontroller = 'INSERT INTO Microcontroller(ModuleID, Battery_Level, timestamp) VALUES ($1, $2, $3)'
        const insertGPS = 'INSERT INTO GPS(ModuleID, Lat, Lon, timestamp) VALUES ($1, $2, $3, $4)'

        const ModuleID = req.body.ModuleID !== undefined ? req.body.ModuleID : 868050040248441;
        const Temperature = req.body.Temperature !== undefined ? req.body.Temperature : 0;
        const Relative_Humidity = req.body.Relative_Humidity !== undefined ? req.body.Relative_Humidity : 0;
        const VOC = req.body.VOC !== undefined ? req.body.VOC : 0;
        const NOx = req.body.NOx !== undefined ? req.body.NOx : 0;
        const PM1 = req.body.PM1 !== undefined ? req.body.PM1 : 0;
        const PM25 = req.body.PM25 !== undefined ? req.body.PM25 : 0;
        const PM4 = req.body.PM4 !== undefined ? req.body.PM4 : 0;
        const PM10 = req.body.PM10 !== undefined ? req.body.PM10 : 0;
        const Soil_Moisture = req.body.Soil_Moisture !== undefined ? req.body.Soil_Moisture : 0;
        const Solar_Input_Current = req.body.Solar_Input_Current !== undefined ? req.body.Solar_Input_Current : 0;
        const Battery_Level = req.body.Battery_Level !== undefined ? req.body.Battery_Level : 0;
        const Lat = req.body.Lat !== undefined ? req.body.Lat : 0;
        const Lon = req.body.Lon !== undefined ? req.body.Lon : 0;
        const timestamp = req.body.timestamp !== undefined ? new Date(req.body.timestamp * 1000) : new Date();

        // const insert = await pool.query(insertText, ['f9e87ab8-2a57-11ee-be56-0242ac120002', 'Soil', 'Howard', 1, 40.6722, 73.9078, now])
        const runInsertSen55 = pool.query(insertSen55, [ModuleID, Temperature, Relative_Humidity, VOC, NOx, PM1, PM25, PM4, PM10, timestamp]).then(res => {console.log(res)}).catch(err => {console.log(err)})
        const runInsertSoil = pool.query(insertSoil, [ModuleID, Soil_Moisture, timestamp])
        const runInsertCurrent_Sensor = pool.query(insertCurrent_Sensor, [ModuleID, Solar_Input_Current, timestamp])
        const runInsertMicrocontroller = pool.query(insertMicrocontroller, [ModuleID, Battery_Level, timestamp])
        const runInsertGPS = pool.query(insertGPS, [ModuleID, Lat, Lon, timestamp])


        // const { rows } = await pool.query('SELECT * FROM Sensors')
        if (req.body.Relative_Humidity) {
            console.log('inserting into SEN55', req.body.Relative_Humidity);
            // const insert = await pool.query(insertSensor, [req.body.SensorID, req.body.Type, req.body.EcoHub_Location, req.body.EcoHub_ID, req.body.Lat, req.body.Lon, now])
        }
        if (req.body.EcoHub_Location) {
            console.log('inserting into Sensors', req.body.EcoHub_Location);
        } else console.log('no EcoHub_Location', req.body.EcoHub_Location);

    }
    // console.log('I am a log entry!');
    // console.error('I am an error!');
    // res.send(`Hello ${req.body.name}, bodyyyyyy=${JSON.stringify(req.body)}!`);
});








const createTableText = ` 

    

`




 
