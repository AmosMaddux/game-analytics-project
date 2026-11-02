-- Ledger rollback only; append-only metrics remain. Restore a backup for full undo.
DROP TABLE IF EXISTS research_qualification_imports;
DELETE FROM local_migrations WHERE name='0008_review_qualification.sql';
