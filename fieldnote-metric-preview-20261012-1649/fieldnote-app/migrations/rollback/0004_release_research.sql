-- Test/working-copy rollback ONLY. Back up any new evidence before rollback.
-- Applying this removes the new research evidence; legacy tables are untouched.
BEGIN IMMEDIATE;
DROP TABLE research_release_evidence;
DROP TABLE research_application_evidence;
DELETE FROM local_migrations WHERE name = '0004_release_research.sql';
COMMIT;
