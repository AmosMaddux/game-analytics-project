CREATE TABLE research_review_contracts (
 contract_id TEXT PRIMARY KEY,method_version TEXT NOT NULL,validation_sha256 TEXT NOT NULL,validated_at TEXT NOT NULL,
 validation_status TEXT NOT NULL CHECK(validation_status='passed'),filters_json TEXT NOT NULL CHECK(json_valid(filters_json)),
 evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json))
);
CREATE TABLE research_activity_observations (
 observation_id TEXT PRIMARY KEY,appid INTEGER NOT NULL REFERENCES games(appid),run_id TEXT NOT NULL,
 metric TEXT NOT NULL CHECK(metric IN ('reviews7d','reviews30d','reviewsCustom')),window_start TEXT NOT NULL,window_end_exclusive TEXT NOT NULL,
 value INTEGER NOT NULL CHECK(value>=0),collected_at TEXT NOT NULL,source_url TEXT NOT NULL,source_scope TEXT NOT NULL,
 unit TEXT NOT NULL CHECK(unit='surviving_matching_review_count'),contract_id TEXT NOT NULL REFERENCES research_review_contracts(contract_id),
 UNIQUE(appid,run_id,metric,window_start,window_end_exclusive,contract_id),CHECK(window_start<window_end_exclusive)
);
CREATE INDEX research_activity_window ON research_activity_observations(metric,window_start,window_end_exclusive);
CREATE TABLE research_metric_imports (
 run_id TEXT PRIMARY KEY,bundle_sha256 TEXT NOT NULL,panel_id TEXT NOT NULL REFERENCES research_panels(panel_id),
 validation_sha256 TEXT NOT NULL,imported_at TEXT NOT NULL,accepted_count INTEGER NOT NULL,missing_count INTEGER NOT NULL,
 metadata_json TEXT NOT NULL CHECK(json_valid(metadata_json))
);
