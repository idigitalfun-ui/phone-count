CREATE TABLE IF NOT EXISTS backups (
  app TEXT NOT NULL CHECK (app IN ('phone-count', 'vapes')),
  captured_at TEXT NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY (app, captured_at)
);

CREATE INDEX IF NOT EXISTS backups_by_app_and_time
  ON backups(app, captured_at DESC);
