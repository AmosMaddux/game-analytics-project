-- Additive offline research evidence. No legacy date is promoted or copied.
-- Application-type evidence is separate from identity or IGDB platform labels.
CREATE TABLE research_application_evidence (
  evidence_id TEXT PRIMARY KEY,
  appid INTEGER NOT NULL REFERENCES games(appid),
  app_type TEXT NOT NULL CHECK(app_type IN ('game','demo','dlc','soundtrack','tool','unknown')),
  verified INTEGER NOT NULL DEFAULT 0 CHECK(verified IN (0,1)),
  source_url TEXT NOT NULL,
  retrieved_at TEXT NOT NULL,
  verification_note TEXT NOT NULL CHECK(length(trim(verification_note)) > 0)
);
CREATE INDEX research_application_evidence_app ON research_application_evidence(appid);
CREATE TABLE research_release_evidence (
  evidence_id TEXT PRIMARY KEY,
  appid INTEGER NOT NULL REFERENCES games(appid),
  release_basis TEXT NOT NULL CHECK(release_basis IN ('first_playable','full_release')),
  release_date TEXT,
  date_precision TEXT NOT NULL CHECK(date_precision IN ('day','month','year','unknown')),
  verified INTEGER NOT NULL DEFAULT 0 CHECK(verified IN (0,1)),
  release_status TEXT NOT NULL CHECK(release_status IN ('released','planned','unknown')),
  phase TEXT CHECK(phase IN ('early_access','full_release')),
  source_url TEXT NOT NULL,
  retrieved_at TEXT NOT NULL,
  verification_note TEXT NOT NULL CHECK(length(trim(verification_note)) > 0),
  CHECK(release_basis <> 'full_release' OR phase IS NULL OR phase = 'full_release')
);
CREATE INDEX research_release_evidence_app ON research_release_evidence(appid,release_basis);
-- Keep foundation_schema and all legacy facts unchanged. local_migrations records this additive migration.
