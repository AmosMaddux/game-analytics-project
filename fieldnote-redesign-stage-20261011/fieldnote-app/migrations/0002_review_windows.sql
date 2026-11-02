-- Review-created windows are separate from cumulative totals and player snapshots.
CREATE TABLE IF NOT EXISTS review_windows (
  appid INTEGER NOT NULL REFERENCES games(appid) ON DELETE CASCADE,
  run_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  period_start TEXT NOT NULL,
  period_end_inclusive TEXT NOT NULL,
  matching_reviews INTEGER NOT NULL CHECK (matching_reviews >= 0),
  evidence_status TEXT NOT NULL DEFAULT 'observed' CHECK (evidence_status = 'observed'),
  method_version TEXT NOT NULL DEFAULT 'saved-review-date-validation-1.0',
  unit TEXT NOT NULL DEFAULT 'surviving_matching_reviews',
  measured_at TEXT,
  collected_at TEXT,
  collection_window_start TEXT,
  collection_window_end TEXT,
  complete_enumeration INTEGER NOT NULL CHECK (complete_enumeration IN (0,1)),
  boundary_exercised INTEGER NOT NULL CHECK (boundary_exercised IN (0,1)),
  source_status TEXT NOT NULL,
  source_scope TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(detail_json)),
  PRIMARY KEY (appid, run_id, period_start, period_end_inclusive)
);

INSERT OR IGNORE INTO foundation_schema VALUES (2, 'Normalized scoped review-date proof windows');
