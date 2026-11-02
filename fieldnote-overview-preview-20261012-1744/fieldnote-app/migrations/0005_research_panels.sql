CREATE TABLE research_panels (
 panel_id TEXT PRIMARY KEY,label TEXT NOT NULL,policy_version TEXT NOT NULL,created_at TEXT NOT NULL,
 as_of TEXT NOT NULL,source_sha256 TEXT NOT NULL,manifest_json TEXT NOT NULL CHECK(json_valid(manifest_json))
);
CREATE TABLE research_panel_memberships (
 panel_id TEXT NOT NULL REFERENCES research_panels(panel_id),appid INTEGER NOT NULL REFERENCES games(appid),
 allocation_group TEXT NOT NULL,reason TEXT NOT NULL,eligibility_json TEXT NOT NULL CHECK(json_valid(eligibility_json)),
 PRIMARY KEY(panel_id,appid)
);
