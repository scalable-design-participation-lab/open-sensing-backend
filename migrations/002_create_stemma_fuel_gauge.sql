-- Create the stemma_fuel_gauge table.
--
-- The uplink payload carries fuelgage_temp, fuelgage_voltage and
-- fuelgage_percent. Until now there was nowhere to put them, so the handler
-- discarded all three on every uplink.
--
-- The payload misspells "gauge" as "gage". That spelling is fixed in the
-- firmware's JSON and not worth breaking devices over, but it does not have
-- to be inherited here: the column names below are spelled correctly, and
-- pushUpLink.js maps the payload keys onto them explicitly. A typo in a
-- wire format is transient; a typo in a column name is written into every
-- query anyone ever runs against this table.
--
-- Shaped like the other per-sensor tables: a ModuleID foreign key, the
-- readings, and the uplink timestamp.
--
-- ModuleID is text, not the numeric that syncDB.js declares. The live
-- Modules.ModuleID is text, and a foreign key has to match the referenced
-- column exactly:
--
--   ERROR: foreign key constraint "stemma_fuel_gauge_moduleid_fkey" cannot
--          be implemented
--   Detail: Key columns "moduleid" and "moduleid" are of incompatible
--           types: numeric and text.
--
-- text is also what the application actually sends. pushUpLink.js derives
-- ModuleID from req.body.ID.split(':')[1], which is a string; the existing
-- numeric columns have been relying on Postgres casting it on every insert.
--
-- syncDB.js has drifted from the live schema and should not be trusted as a
-- reference — it also predates bme_280, scd_41, blues_notecard and
-- modulesensors.
--
-- Safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS stemma_fuel_gauge (
    ModuleID text references Modules(ModuleID),
    fuel_gauge_temp decimal,
    fuel_gauge_voltage decimal,
    fuel_gauge_percent decimal,
    timestamp TIMESTAMP
);

-- Readings are almost always fetched for one module over a time range, which
-- is a sequential scan without this. The sibling tables predate any indexing
-- and have none; drop this statement if you would rather keep them uniform.
CREATE INDEX IF NOT EXISTS stemma_fuel_gauge_moduleid_timestamp_idx
    ON stemma_fuel_gauge (ModuleID, timestamp);

COMMIT;

-- fuel_gauge_percent is decimal rather than integer because a fuel gauge
-- reports fractional state of charge; rounding at write time would throw
-- away precision the sensor actually provides.
