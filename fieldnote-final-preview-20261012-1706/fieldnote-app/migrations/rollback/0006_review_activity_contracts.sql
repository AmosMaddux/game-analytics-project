-- Retains append-only lifetime/player metric history. Full undo restores a backup.
DROP TABLE IF EXISTS research_metric_imports;
DROP TABLE IF EXISTS research_activity_observations;
DROP TABLE IF EXISTS research_review_contracts;
DELETE FROM local_migrations WHERE name='0006_review_activity_contracts.sql';
