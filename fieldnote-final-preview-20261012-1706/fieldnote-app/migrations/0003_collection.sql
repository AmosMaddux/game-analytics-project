-- Bounded local collection. No process/schedule is started by applying schema.
CREATE TABLE IF NOT EXISTS collection_jobs (
  job_id TEXT PRIMARY KEY, source TEXT NOT NULL, kind TEXT NOT NULL,
  status TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT,
  checkpoint_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(checkpoint_json)),
  limits_json TEXT NOT NULL CHECK(json_valid(limits_json)),
  counters_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(counters_json)),
  error_code TEXT, next_run_at TEXT
);
CREATE TABLE IF NOT EXISTS source_health (
  source TEXT PRIMARY KEY, status TEXT NOT NULL, last_attempt_at TEXT,
  last_success_at TEXT, last_error_code TEXT,
  details_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(details_json))
);
CREATE TABLE IF NOT EXISTS collection_attempts (
  job_id TEXT NOT NULL REFERENCES collection_jobs(job_id), item_key TEXT NOT NULL,
  source TEXT NOT NULL, appid INTEGER, metric TEXT, status TEXT NOT NULL,
  attempted_at TEXT NOT NULL, error_code TEXT, PRIMARY KEY(job_id,item_key)
);
CREATE TABLE IF NOT EXISTS collection_schedules (
  id TEXT PRIMARY KEY, source TEXT NOT NULL, kind TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  interval_hours INTEGER NOT NULL CHECK(interval_hours IN (6,24)),
  watchlist_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(watchlist_json)),
  next_run_at TEXT, expires_at TEXT,
  limits_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(limits_json))
);
CREATE TABLE IF NOT EXISTS catalog_admissions (
  appid INTEGER PRIMARY KEY REFERENCES games(appid) ON DELETE CASCADE,
  admitted_at TEXT NOT NULL, job_id TEXT NOT NULL,
  taxonomy_version TEXT NOT NULL, mapping_json TEXT NOT NULL CHECK(json_valid(mapping_json)),
  steam_verified_at TEXT NOT NULL, steam_name_source TEXT NOT NULL,
  catalog_stratum TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS collection_rejections (
  job_id TEXT NOT NULL REFERENCES collection_jobs(job_id), item_key TEXT NOT NULL,
  appid INTEGER, igdb_id INTEGER, reason TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(details_json)),
  PRIMARY KEY(job_id,item_key)
);
CREATE INDEX IF NOT EXISTS collection_jobs_recent ON collection_jobs(started_at DESC);
CREATE INDEX IF NOT EXISTS collection_attempts_app ON collection_attempts(appid,metric,attempted_at DESC);
INSERT OR IGNORE INTO source_health(source,status,details_json) VALUES
('igdb','user_run_required','{"label":"IGDB catalog","gate":{"status":"private_noncommercial_cache_permitted","note":"User-run authentication required. Current local refreshable cache permitted; public redistribution and enduring archive remain unapproved."},"officialLinks":[{"label":"IGDB documentation","url":"https://api-docs.igdb.com/"}],"retentionNote":"Refreshable local cache; honor corrections, deletions and service termination. No automatic deletion of user records.","collectionNote":"Bounded personally invoked collection. No background daemon."}'),
('steam_api','ready_not_running','{"label":"Steam public metrics","gate":{"status":"bounded_aggregate_read_permitted","note":"Keyless current players and aggregate review summaries only; no reviewer identities or text retained."},"officialLinks":[{"label":"Steam Web API terms","url":"https://steamcommunity.com/dev/apiterms"}],"collectionNote":"At least one second between requests; bounded retries and stop on authorization failure."}'),
('steam_catalog','verification_required','{"label":"Steam identity verification","gate":{"status":"verification_required","note":"Current official AppID/name list requires a Steam Web API key. A successful one-shot deprecated keyless endpoint may verify this run only."},"officialLinks":[{"label":"Steam app catalog API","url":"https://partner.steamgames.com/doc/webapi/IStoreService#GetAppList"}]}'),
('steam_tags','blocked_pending_permission','{"label":"Steam tags","gate":{"status":"new_acquisition_blocked","note":"Only the preserved permitted Steam tag observations remain. IGDB labels never substitute for Steam tags."},"collectionNote":"No automated Steam store HTML acquisition. New games have missing tags."}');
INSERT OR IGNORE INTO collection_schedules(id,source,kind,interval_hours) VALUES
('daily-steam','steam_api','metrics',24),
('daily-catalog','igdb','catalog',24),
('six-hour-watchlist','steam_api','watchlist',6);
INSERT OR IGNORE INTO foundation_schema VALUES(3,'Bounded collection jobs, health, schedules and admission ledger');
