-- Backfill Modules.timestamp for rows that predate it being written.
--
-- Modules.timestamp now means "when the stored lat/lon was last established".
-- Nothing ever wrote that column before, so every existing row holds NULL.
-- Modules.lat/lon was only ever set by the INSERT that first registered the
-- module, so the moment it was established is that module's earliest GPS fix.
--
-- Safe to re-run: it only touches rows where timestamp IS NULL, so it will
-- never overwrite a value written by the application.
--
-- Preview before applying — this is read-only and changes nothing:
--
--   SELECT m.moduleid, m.lat, m.lon, g.first_fix
--   FROM Modules m
--   JOIN (
--       SELECT gps.moduleid, MIN(gps.timestamp) AS first_fix
--       FROM GPS gps
--       WHERE gps.timestamp > TIMESTAMP '2000-01-01'
--       GROUP BY gps.moduleid
--   ) g ON g.moduleid = m.moduleid
--   WHERE m.timestamp IS NULL
--     AND m.lat IS NOT NULL
--     AND m.lon IS NOT NULL
--   ORDER BY g.first_fix;

BEGIN;

UPDATE Modules m
SET timestamp = g.first_fix
FROM (
    SELECT gps.moduleid, MIN(gps.timestamp) AS first_fix
    FROM GPS gps
    -- Exclude 1970-01-01 rows. Uplinks that arrived without a usable
    -- timestamp used to be stored at the unix epoch, so an unfiltered MIN()
    -- would date a module's location to 1970 wherever one of those landed.
    -- Qualified as gps.timestamp throughout: bare `timestamp` in expression
    -- position is also a type name in Postgres.
    WHERE gps.timestamp > TIMESTAMP '2000-01-01'
    GROUP BY gps.moduleid
) g
WHERE m.moduleid = g.moduleid
  -- Backfill only; never overwrite a timestamp the application has written.
  AND m.timestamp IS NULL
  -- A module with no stored position has no "location established" moment.
  -- The application fills both in together on its next uplink with a fix.
  AND m.lat IS NOT NULL
  AND m.lon IS NOT NULL;

COMMIT;

-- Rows deliberately left NULL after this runs:
--   * modules with no GPS fixes at all
--   * modules whose only GPS fixes are epoch rows from the timestamp bug
--   * modules registered without a position (lat/lon still NULL)
-- Each is a case where there is genuinely nothing to say about when the
-- stored location was established.
