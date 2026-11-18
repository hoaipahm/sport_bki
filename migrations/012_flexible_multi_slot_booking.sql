BEGIN;

-- Allow 30-minute single-slot or multi-slot flexible booking across all sports
UPDATE sports
SET min_duration_mins = 30
WHERE min_duration_mins > 30;

COMMIT;
