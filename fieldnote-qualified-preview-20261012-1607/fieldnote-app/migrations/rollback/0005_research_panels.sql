-- Drop dependent0006 tables first. Use a backup for full rollback.
DROP TABLE IF EXISTS research_panel_memberships;
DROP TABLE IF EXISTS research_panels;
DELETE FROM local_migrations WHERE name='0005_research_panels.sql';
