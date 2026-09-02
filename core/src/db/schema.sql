-- No FOREIGN KEY constraints are declared, deliberately. This index is rebuilt
-- wholesale from markdown and transcripts rather than mutated in place, so
-- referential integrity is a property of the rebuild, not of the database.
-- `PRAGMA foreign_keys = ON` is set in open.ts so that any constraint added
-- later is enforced from the start.

CREATE TABLE IF NOT EXISTS projects (
  path          TEXT PRIMARY KEY,
  slug          TEXT NOT NULL,
  name          TEXT NOT NULL,
  git_remote    TEXT,
  last_seen_at  TEXT
);

CREATE TABLE IF NOT EXISTS notes (
  id            TEXT PRIMARY KEY,
  project       TEXT NOT NULL,
  path          TEXT NOT NULL,
  title         TEXT NOT NULL,
  kind          TEXT NOT NULL,
  status        TEXT NOT NULL,
  decided_on    TEXT,
  confidence    TEXT,
  review_after  TEXT,
  hash          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS notes_project_idx ON notes(project);
CREATE INDEX IF NOT EXISTS notes_status_idx  ON notes(status);

CREATE TABLE IF NOT EXISTS note_evidence (
  note_id           TEXT NOT NULL,
  kind              TEXT NOT NULL,
  ref               TEXT NOT NULL,
  last_verified_at  TEXT,
  ok                INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (note_id, kind, ref)
);

CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
  note_id UNINDEXED,
  title,
  question,
  chosen,
  rejected,
  body,
  tokenize = 'unicode61'
);

CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,
  project      TEXT NOT NULL,
  started_at   TEXT,
  ended_at     TEXT,
  branch       TEXT,
  model        TEXT,
  effort       TEXT,
  title        TEXT,
  correlation  TEXT NOT NULL DEFAULT 'exact'
);
CREATE INDEX IF NOT EXISTS sessions_project_idx ON sessions(project);

CREATE TABLE IF NOT EXISTS activities (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id   TEXT NOT NULL,
  seq          INTEGER NOT NULL,
  ts           TEXT,
  kind         TEXT NOT NULL,
  tool_name    TEXT,
  attr_skill   TEXT,
  attr_plugin  TEXT,
  UNIQUE (session_id, seq)
);
CREATE INDEX IF NOT EXISTS activities_session_idx ON activities(session_id);

CREATE TABLE IF NOT EXISTS ingest_cursors (
  file_path     TEXT PRIMARY KEY,
  byte_offset   INTEGER NOT NULL,
  last_seen_at  TEXT NOT NULL
);

-- Live events from the agent CLI. Derived like everything else here: the
-- transcript remains the durable record, and this table exists so a session can
-- be bound to its id the moment it starts rather than inferred afterwards.
CREATE TABLE IF NOT EXISTS hook_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id   TEXT NOT NULL,
  kind         TEXT NOT NULL,
  ts           TEXT,
  payload_json TEXT NOT NULL,
  UNIQUE (session_id, kind, ts, payload_json)
);
CREATE INDEX IF NOT EXISTS hook_events_session_idx ON hook_events(session_id);
