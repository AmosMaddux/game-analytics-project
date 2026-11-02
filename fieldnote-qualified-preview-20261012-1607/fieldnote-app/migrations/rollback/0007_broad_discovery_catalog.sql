-- Overlay rollback only. Do not delete admitted games which may have later evidence.
-- Full undo restores the immutable backup to a NEW path.
DROP TABLE IF EXISTS research_catalog_records;
DROP TABLE IF EXISTS research_catalog_imports;
DELETE FROM local_migrations WHERE name='0007_broad_discovery_catalog.sql';
