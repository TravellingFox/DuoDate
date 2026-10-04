UPDATE "Destination"
SET "timeZone" = CASE lower(trim("name"))
  WHEN 'berlin' THEN 'Europe/Berlin'
  WHEN 'lisbon' THEN 'Europe/Lisbon'
  WHEN 'salvador' THEN 'America/Bahia'
  WHEN 'online' THEN 'Europe/Berlin'
  WHEN 'global' THEN 'Europe/Berlin'
  ELSE "timeZone"
END
WHERE lower(trim("name")) IN ('berlin', 'lisbon', 'salvador', 'online', 'global');
