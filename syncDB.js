const pg = require("pg");

const dbName = 'test_module'
// const dbName = 'fk_module'
// const dbName = 'gcf_module'

const credentials = {
    host: process.env.host,
    database: process.env.database,
    port:"5432",
    user:"postgres",
    password: process.env.password
}    

const pool = new pg.Pool(credentials); 



const createTableText = ` 
CREATE TABLE IF NOT EXISTS Modules (
  ModuleID numeric PRIMARY KEY,
  EcoHub_Location character varying(255),
  EcoHub_ID integer,
  Lat double precision,
  Lon double precision,
  timestamp TIMESTAMP
);

CREATE TABLE IF NOT EXISTS SEN55 (
    ModuleID numeric references Modules(ModuleID),
    Temperature decimal,
    Relative_Humidity decimal,
    VOC integer,
    NOx integer,
    PM1 decimal,
    PM25 decimal,
    PM4 decimal,
    PM10 decimal,
    timestamp TIMESTAMP
);

CREATE TABLE IF NOT EXISTS Soil (
    ModuleID numeric references Modules(ModuleID),
    Soil_Moisture decimal,
    timestamp TIMESTAMP
);
    
CREATE TABLE IF NOT EXISTS Current_Sensor (
    ModuleID numeric references Modules(ModuleID),
    Solar_Input_Current decimal,
    timestamp TIMESTAMP
);
  
CREATE TABLE IF NOT EXISTS Microcontroller (
    ModuleID numeric references Modules(ModuleID),
    Battery_Level decimal,
    timestamp TIMESTAMP
);
    
CREATE TABLE IF NOT EXISTS GPS (
    ModuleID numeric references Modules(ModuleID),
    Lat double precision,
    Lon double precision,
    timestamp TIMESTAMP
);
`

const dropTableText = `
DROP TABLE IF EXISTS Modules; 
DROP TABLE IF EXISTS SEN55; 
DROP TABLE IF EXISTS Soil; 
DROP TABLE IF EXISTS Current_Sensor; 
DROP TABLE IF EXISTS Microcontroller; 
DROP TABLE IF EXISTS GPS; 
`
//    SensorID numeric FOREIGN KEY REFERENCES Sensors(SensorID)
// SensorID numeric references Sensors(SensorID),


// create our tables
// const result =  pool.query(createTableText)

// empty our tables
// const result =  pool.query(dropTableText)


// Insert a test row into the Sensor table
const now = new Date()
const insertText = 'INSERT INTO Modules(ModuleID, EcoHub_Location, EcoHub_ID, Lat, Lon, timestamp) VALUES ($1, $2, $3, $4, $5, $6)'
// const insert = pool.query(insertText, [868050040248441, 'Howard Houses', 1, 40.672212500000015, -73.916484375, now])
// const insert = pool.query(insertText, [868050040248441, 'Soil', 'Howard', 1, 40.672212500000015, -73.916484375, now])


// const insertTextMoisture = 'INSERT INTO Soil(SensorID, Soil_Moisture, timestamp) VALUES ($1, $2, $3)'
// const insert = pool.query(insertTextMoisture, [868050040248441, 55, now])


const test = async () => {
    const { rows } = await pool.query('SELECT * FROM SEN55 WHERE PM25 > 0')
    return rows
}
const rows = test().then((rows) => {
    console.log(rows, 234234);
})

 