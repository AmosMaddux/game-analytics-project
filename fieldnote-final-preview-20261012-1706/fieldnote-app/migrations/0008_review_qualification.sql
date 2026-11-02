CREATE TABLE research_qualification_imports (
 run_id TEXT PRIMARY KEY,bundle_sha256 TEXT NOT NULL UNIQUE,candidate_source_sha256 TEXT NOT NULL,
 validation_sha256 TEXT NOT NULL,imported_at TEXT NOT NULL,accepted_count INTEGER NOT NULL CHECK(accepted_count>0),
 metadata_json TEXT NOT NULL CHECK(json_valid(metadata_json))
);
