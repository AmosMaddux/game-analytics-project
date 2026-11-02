CREATE TABLE research_catalog_imports (
 import_id TEXT PRIMARY KEY,source_sha256 TEXT NOT NULL UNIQUE,imported_at TEXT NOT NULL,source_finished_at TEXT NOT NULL,
 source_status TEXT NOT NULL,verified_count INTEGER NOT NULL,new_games INTEGER NOT NULL,existing_games INTEGER NOT NULL,
 metadata_json TEXT NOT NULL CHECK(json_valid(metadata_json))
);
CREATE TABLE research_catalog_records (
 import_id TEXT NOT NULL REFERENCES research_catalog_imports(import_id),appid INTEGER NOT NULL REFERENCES games(appid),
 igdb_id INTEGER NOT NULL,collected_at TEXT NOT NULL,raw_json TEXT NOT NULL CHECK(json_valid(raw_json)),PRIMARY KEY(import_id,appid)
);
CREATE INDEX research_catalog_latest ON research_catalog_records(appid,collected_at);
