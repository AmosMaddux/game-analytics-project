-- M2 offline foundation. SQLite syntax is deliberately compatible with D1.
-- Entity details preserve secondary provider fields, not whole-game/import blobs.
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS foundation_schema (
  version INTEGER PRIMARY KEY,
  description TEXT NOT NULL
);
INSERT OR IGNORE INTO foundation_schema VALUES (1, 'Normalized offline research foundation');
CREATE TABLE IF NOT EXISTS snapshot_metadata (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL CHECK (json_valid(value_json))
);
CREATE TABLE IF NOT EXISTS genres (
  name TEXT PRIMARY KEY,
  position INTEGER NOT NULL UNIQUE,
  taxonomy_version TEXT NOT NULL DEFAULT 'editorial-cohort-1.0'
);
CREATE TABLE IF NOT EXISTS cohorts (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  declared_count INTEGER NOT NULL,
  position INTEGER NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(detail_json))
);
CREATE TABLE IF NOT EXISTS games (
  appid INTEGER PRIMARY KEY CHECK (appid > 0 AND appid <= 4294967295),
  source_id TEXT NOT NULL UNIQUE CHECK (source_id = CAST(appid AS TEXT)),
  name TEXT NOT NULL,
  steam_name TEXT NOT NULL,
  genre TEXT NOT NULL REFERENCES genres(name),
  cohort_id TEXT NOT NULL REFERENCES cohorts(id),
  release_display TEXT,
  store_url TEXT NOT NULL,
  collected_at TEXT,
  position INTEGER NOT NULL UNIQUE,
  detail_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(detail_json))
);
CREATE INDEX IF NOT EXISTS games_genre ON games(genre);
CREATE INDEX IF NOT EXISTS games_name ON games(name COLLATE NOCASE);
CREATE TABLE IF NOT EXISTS steam_tags (
  appid INTEGER NOT NULL REFERENCES games(appid) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  tag TEXT NOT NULL,
  source_url TEXT,
  collected_at TEXT,
  evidence_status TEXT NOT NULL DEFAULT 'observed' CHECK (evidence_status = 'observed'),
  method_version TEXT NOT NULL DEFAULT 'saved-steam-store-tags-1.0',
  PRIMARY KEY (appid, position)
);
CREATE INDEX IF NOT EXISTS steam_tags_label ON steam_tags(tag, appid);
CREATE TABLE IF NOT EXISTS metric_observations (
  observation_id TEXT PRIMARY KEY,
  appid INTEGER NOT NULL REFERENCES games(appid) ON DELETE CASCADE,
  metric TEXT NOT NULL CHECK (metric IN ('players','reviews','storeReviews')),
  value REAL CHECK (value IS NULL OR value >= 0),
  evidence_status TEXT NOT NULL CHECK (evidence_status IN ('observed','reported','calculated','estimated','unknown','unavailable')),
  freshness TEXT NOT NULL CHECK (freshness IN ('fresh','stale','unknown')),
  freshness_as_of TEXT,
  measured_at TEXT,
  collected_at TEXT,
  source_url TEXT,
  source_label TEXT,
  source_scope TEXT NOT NULL,
  unit TEXT NOT NULL,
  method_version TEXT NOT NULL,
  source_status TEXT,
  source_freshness TEXT,
  run_id TEXT,
  original_keys_json TEXT NOT NULL CHECK (json_valid(original_keys_json)),
  detail_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(detail_json)),
  UNIQUE(appid, metric, run_id, collected_at),
  CHECK ((evidence_status NOT IN ('unknown','unavailable')) OR value IS NULL)
);
CREATE INDEX IF NOT EXISTS metric_observations_game_metric ON metric_observations(appid, metric, collected_at DESC);
CREATE TABLE IF NOT EXISTS catalog_games (
  appid INTEGER PRIMARY KEY REFERENCES games(appid) ON DELETE CASCADE,
  igdb_id INTEGER NOT NULL UNIQUE CHECK (igdb_id > 0),
  match_status TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source = 'IGDB'),
  source_url TEXT,
  name TEXT,
  summary TEXT,
  first_release_at TEXT,
  collected_at TEXT,
  source_updated_at TEXT,
  identity_json TEXT NOT NULL CHECK (json_valid(identity_json)),
  detail_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(detail_json)),
  UNIQUE (appid, igdb_id)
);
CREATE TABLE IF NOT EXISTS identity_crosswalks (
  appid INTEGER NOT NULL,
  igdb_id INTEGER NOT NULL,
  position INTEGER NOT NULL,
  external_record_id INTEGER NOT NULL,
  steam_uid TEXT NOT NULL CHECK (steam_uid = CAST(appid AS TEXT)),
  external_source_id INTEGER NOT NULL CHECK (external_source_id = 1),
  source_name TEXT NOT NULL CHECK (source_name = 'Steam'),
  source_url TEXT NOT NULL,
  source_updated_at TEXT,
  rule_version TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(detail_json)),
  PRIMARY KEY (appid, position),
  FOREIGN KEY (appid, igdb_id) REFERENCES catalog_games(appid, igdb_id) ON DELETE CASCADE
);
-- Scoped, ordered catalog entities; role membership is kept distinct.
CREATE TABLE IF NOT EXISTS catalog_platforms (
  appid INTEGER NOT NULL REFERENCES catalog_games(appid) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  source_id INTEGER NOT NULL,
  name TEXT,
  detail_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(detail_json)),
  PRIMARY KEY (appid, position)
);
CREATE TABLE IF NOT EXISTS catalog_company_roles (
  appid INTEGER NOT NULL REFERENCES catalog_games(appid) ON DELETE CASCADE,
  collection TEXT NOT NULL CHECK (collection IN ('developers','publishers','companies')),
  position INTEGER NOT NULL,
  source_id INTEGER NOT NULL,
  company_id INTEGER NOT NULL,
  name TEXT,
  developer INTEGER CHECK (developer IN (0,1)),
  publisher INTEGER CHECK (publisher IN (0,1)),
  porting INTEGER CHECK (porting IN (0,1)),
  supporting INTEGER CHECK (supporting IN (0,1)),
  detail_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(detail_json)),
  PRIMARY KEY (appid, collection, position)
);
CREATE TABLE IF NOT EXISTS catalog_labels (
  appid INTEGER NOT NULL REFERENCES catalog_games(appid) ON DELETE CASCADE,
  collection TEXT NOT NULL CHECK (collection IN ('genres','themes','keywords')),
  position INTEGER NOT NULL,
  source_id INTEGER NOT NULL,
  name TEXT,
  detail_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(detail_json)),
  PRIMARY KEY (appid, collection, position)
);
CREATE TABLE IF NOT EXISTS catalog_links (
  appid INTEGER NOT NULL REFERENCES catalog_games(appid) ON DELETE CASCADE,
  collection TEXT NOT NULL CHECK (collection IN ('websites','officialWebsites')),
  position INTEGER NOT NULL,
  source_id INTEGER NOT NULL,
  url TEXT NOT NULL,
  type_id INTEGER,
  type_name TEXT,
  trusted INTEGER NOT NULL CHECK (trusted IN (0,1)),
  detail_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(detail_json)),
  PRIMARY KEY (appid, collection, position)
);
CREATE TABLE IF NOT EXISTS catalog_releases (
  appid INTEGER NOT NULL REFERENCES catalog_games(appid) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  source_id INTEGER NOT NULL,
  release_at TEXT,
  display_date TEXT,
  platform_id INTEGER,
  platform_json TEXT CHECK (platform_json IS NULL OR json_valid(platform_json)),
  region_id INTEGER,
  region_json TEXT CHECK (region_json IS NULL OR json_valid(region_json)),
  date_format_json TEXT CHECK (date_format_json IS NULL OR json_valid(date_format_json)),
  status_json TEXT CHECK (status_json IS NULL OR json_valid(status_json)),
  detail_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(detail_json)),
  PRIMARY KEY (appid, position)
);
CREATE TABLE IF NOT EXISTS catalog_field_provenance (
  appid INTEGER NOT NULL REFERENCES catalog_games(appid) ON DELETE CASCADE,
  field TEXT NOT NULL,
  source_provider TEXT,
  source_entity_id INTEGER,
  field_path TEXT,
  source_url TEXT,
  collected_at TEXT,
  source_updated_at TEXT,
  measured_at TEXT,
  unit TEXT,
  source_status TEXT,
  detail_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(detail_json)),
  PRIMARY KEY (appid, field)
);
CREATE TABLE IF NOT EXISTS catalog_conflicts (
  appid INTEGER NOT NULL REFERENCES catalog_games(appid) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  field TEXT,
  status TEXT,
  reason TEXT,
  detail_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(detail_json)),
  PRIMARY KEY (appid, position)
);
CREATE TABLE IF NOT EXISTS marketing_profiles (
  appid INTEGER PRIMARY KEY REFERENCES games(appid) ON DELETE CASCADE,
  source_status TEXT NOT NULL,
  source_url TEXT,
  source_label TEXT,
  organization TEXT,
  source_role TEXT,
  summary TEXT,
  collected_at TEXT,
  deep_proof INTEGER NOT NULL CHECK (deep_proof IN (0,1)),
  exhaustive INTEGER NOT NULL CHECK (exhaustive IN (0,1)),
  original_keys_json TEXT NOT NULL CHECK (json_valid(original_keys_json)),
  detail_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(detail_json))
);
CREATE TABLE IF NOT EXISTS marketing_events (
  appid INTEGER NOT NULL REFERENCES marketing_profiles(appid) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  source_date TEXT,
  date_kind TEXT NOT NULL,
  event_at TEXT,
  published_at TEXT,
  discovered_at TEXT,
  collected_at TEXT,
  source_url TEXT,
  discovery_source_url TEXT,
  summary TEXT,
  detail_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(detail_json)),
  PRIMARY KEY (appid, position)
);
CREATE TABLE IF NOT EXISTS ui_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  monthly_budget_usd REAL NOT NULL DEFAULT 30 CHECK (monthly_budget_usd >= 0 AND monthly_budget_usd <= 30),
  compact_tables INTEGER NOT NULL DEFAULT 0 CHECK (compact_tables IN (0,1)),
  show_evidence_details INTEGER NOT NULL DEFAULT 1 CHECK (show_evidence_details IN (0,1)),
  updated_at TEXT
);
INSERT OR IGNORE INTO ui_settings(id) VALUES (1);
