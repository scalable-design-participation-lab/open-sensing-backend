-- Create the fuelgage table.
--
-- The uplink payload carries fuelgage_temp, fuelgage_voltage and
-- fuelgage_percent. Until now there was nowhere to put them, so the handler
-- discarded all three on every uplink.
--
-- Column names mirror the payload keys, and the table follows the same shape
-- as the other per-sensor tables: a ModuleID foreign key, the readings, and
-- the uplink timestamp. Spelling follows the payload's "fuelgage" rather than
-- correcting it to "fuel_gauge", so the field and column names stay in step.
--
-- Safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS fuelgage (
    ModuleID numeric references Modules(ModuleID),
    fuelgage_temp decimal,
    fuelgage_voltage decimal,
    fuelgage_percent decimal,
    timestamp TIMESTAMP
);

-- Readings are almost always fetched for one module over a time range, which
-- is a sequential scan without this. The sibling tables predate any indexing
-- and have none; drop this statement if you would rather keep them uniform.
CREATE INDEX IF NOT EXISTS fuelgage_moduleid_timestamp_idx
    ON fuelgage (ModuleID, timestamp);

COMMIT;

-- fuelgage_percent is decimal rather than integer because a fuel gauge
-- reports fractional state of charge; rounding at write time would throw
-- away precision the sensor actually provides.
