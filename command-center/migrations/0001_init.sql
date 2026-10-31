-- Fork Algorithm — Agent Command Center: initial schema (Cloudflare D1 / SQLite)
-- Timestamps are ISO-8601 UTC strings. Booleans are 0/1.
-- Rows with is_demo = 1 are demonstration data and must never be presented as real results.

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------- identity
CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('owner','admin','operator','viewer')),
  password_hash TEXT,                       -- PBKDF2; NULL for the env-configured owner
  disabled      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,             -- SHA-256 of the session token
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  ip          TEXT,
  user_agent  TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE rate_limits (
  bucket      TEXT NOT NULL,                -- e.g. login:203.0.113.4
  window_start INTEGER NOT NULL,            -- unix seconds, floored to window
  count       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window_start)
);

-- ---------------------------------------------------------------- org
CREATE TABLE departments (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  is_custom   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

CREATE TABLE agents (
  id               TEXT PRIMARY KEY,
  slug             TEXT NOT NULL UNIQUE,
  name             TEXT NOT NULL,
  role_title       TEXT NOT NULL,
  department_id    TEXT REFERENCES departments(id),
  reports_to       TEXT REFERENCES agents(id),   -- NULL = reports to the founder
  icon             TEXT NOT NULL DEFAULT 'bot',
  accent           TEXT NOT NULL DEFAULT 'emerald',
  nameplate_style  TEXT NOT NULL DEFAULT 'standard',
  responsibilities TEXT NOT NULL DEFAULT '[]',   -- JSON array of strings
  system_prompt    TEXT NOT NULL DEFAULT '',
  provider         TEXT NOT NULL DEFAULT 'none', -- none | anthropic | custom-worker
  model            TEXT NOT NULL DEFAULT '',
  autonomy         TEXT NOT NULL DEFAULT 'draft_only'
                   CHECK (autonomy IN ('observer','draft_only','supervised','preapproved_routine')),
  priority         TEXT NOT NULL DEFAULT 'normal'
                   CHECK (priority IN ('low','normal','high','critical')),
  authority_level  INTEGER NOT NULL DEFAULT 1 CHECK (authority_level BETWEEN 0 AND 5),
  enabled          INTEGER NOT NULL DEFAULT 0,   -- profile enabled; does NOT start a process
  paused           INTEGER NOT NULL DEFAULT 0,
  schedule         TEXT NOT NULL DEFAULT '{}',   -- JSON {days:[], start:"09:00", end:"17:00", tz:"America/New_York"}
  replaced_by      TEXT REFERENCES agents(id),
  archived         INTEGER NOT NULL DEFAULT 0,
  is_core          INTEGER NOT NULL DEFAULT 0,
  last_heartbeat_at          TEXT,              -- last contact from an external worker
  last_confirmed_execution_at TEXT,             -- last task a worker/executor confirmed finished
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

-- Requested capability vs. owner grant. Effective access also requires the
-- backing integration to be connected (computed at runtime, never stored).
CREATE TABLE agent_capabilities (
  agent_id     TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  capability   TEXT NOT NULL,
  requested    INTEGER NOT NULL DEFAULT 0,
  granted      INTEGER NOT NULL DEFAULT 0,
  granted_by   TEXT REFERENCES users(id),
  granted_at   TEXT,
  PRIMARY KEY (agent_id, capability)
);

-- ---------------------------------------------------------------- work
CREATE TABLE tasks (
  id               TEXT PRIMARY KEY,           -- TSK-YYYYMMDD-XXXXXX
  title            TEXT NOT NULL,
  description      TEXT NOT NULL DEFAULT '',
  agent_id         TEXT REFERENCES agents(id),
  status           TEXT NOT NULL
                   CHECK (status IN ('proposed','awaiting_approval','scheduled','running','completed','failed','paused','cancelled')),
  priority         TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','critical')),
  kind             TEXT NOT NULL DEFAULT 'general', -- general | draft | research | outreach | report | financial | access
  requires_approval INTEGER NOT NULL DEFAULT 0,
  approval_id      TEXT,
  idempotency_key  TEXT UNIQUE,                -- duplicate prevention
  parent_task_id   TEXT REFERENCES tasks(id),
  source           TEXT NOT NULL DEFAULT 'manual', -- manual | agent | worker | cron | webhook
  created_by       TEXT,                        -- user id or agent id
  scheduled_for    TEXT,
  started_at       TEXT,
  completed_at     TEXT,
  lease_expires_at TEXT,                        -- running tasks whose lease lapses are recovered
  attempts         INTEGER NOT NULL DEFAULT 0,
  max_attempts     INTEGER NOT NULL DEFAULT 3,
  result           TEXT,
  error            TEXT,
  is_demo          INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_agent ON tasks(agent_id);

CREATE TABLE task_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  ts         TEXT NOT NULL,
  level      TEXT NOT NULL CHECK (level IN ('debug','info','warn','error')),
  message    TEXT NOT NULL,
  actor      TEXT NOT NULL                       -- user:<id> | agent:<id> | worker | system
);
CREATE INDEX idx_task_logs_task ON task_logs(task_id);

CREATE TABLE approvals (
  id             TEXT PRIMARY KEY,               -- APR-...
  task_id        TEXT REFERENCES tasks(id),
  title          TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  category       TEXT NOT NULL DEFAULT 'general'
                 CHECK (category IN ('general','outbound_campaign','financial','access','security','publication')),
  risk_level     TEXT NOT NULL DEFAULT 'medium' CHECK (risk_level IN ('low','medium','high','critical')),
  requested_by   TEXT,                           -- agent id or user id
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','held')),
  decided_by     TEXT REFERENCES users(id),
  decided_at     TEXT,
  decision_note  TEXT,
  is_demo        INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL
);
CREATE INDEX idx_approvals_status ON approvals(status);

-- ---------------------------------------------------------------- chief of staff
CREATE TABLE recommendations (
  id          TEXT PRIMARY KEY,
  agent_id    TEXT REFERENCES agents(id),
  week_of     TEXT NOT NULL,                     -- Monday of the week, YYYY-MM-DD
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','liked','disliked','modify_requested','held','actioned')),
  source      TEXT NOT NULL DEFAULT 'manual',    -- manual | ai | aggregation
  is_demo     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

CREATE TABLE feedback (
  id                TEXT PRIMARY KEY,
  recommendation_id TEXT REFERENCES recommendations(id) ON DELETE CASCADE,
  verdict           TEXT NOT NULL CHECK (verdict IN ('like','dislike','modify','hold')),
  note              TEXT NOT NULL DEFAULT '',
  user_id           TEXT REFERENCES users(id),
  created_at        TEXT NOT NULL
);

-- Planning preferences derived from founder feedback. Protected keys
-- (financial limits, legal permissions, system access) are rejected by the API.
CREATE TABLE founder_preferences (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  source_feedback_id TEXT,
  updated_by  TEXT,
  updated_at  TEXT NOT NULL
);

CREATE TABLE briefings (
  id           TEXT PRIMARY KEY,
  week_of      TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  generated_by TEXT NOT NULL,                    -- 'aggregation' | 'aggregation+ai'
  trigger_kind TEXT NOT NULL DEFAULT 'manual',   -- manual | scheduled
  content      TEXT NOT NULL,                    -- JSON
  narrative    TEXT,                             -- AI narrative, if a provider was configured
  status       TEXT NOT NULL DEFAULT 'final'
);
CREATE INDEX idx_briefings_week ON briefings(week_of);

-- ---------------------------------------------------------------- settings / financial limits
CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  protected  INTEGER NOT NULL DEFAULT 0,         -- only owner can change, never via feedback
  updated_by TEXT,
  updated_at TEXT NOT NULL
);

-- ---------------------------------------------------------------- observability
CREATE TABLE alerts (
  id              TEXT PRIMARY KEY,
  severity        TEXT NOT NULL CHECK (severity IN ('info','warning','critical')),
  category        TEXT NOT NULL,                 -- security | failure | approval | integration | system
  title           TEXT NOT NULL,
  body            TEXT NOT NULL DEFAULT '',
  agent_id        TEXT,
  task_id         TEXT,
  acknowledged_by TEXT,
  acknowledged_at TEXT,
  dedupe_key      TEXT UNIQUE,
  is_demo         INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL
);

CREATE TABLE audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          TEXT NOT NULL,
  actor       TEXT NOT NULL,                     -- user:<id> | worker | system | webhook:make
  action      TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   TEXT,
  details     TEXT NOT NULL DEFAULT '{}',
  ip          TEXT
);
CREATE INDEX idx_audit_ts ON audit_log(ts);

-- ---------------------------------------------------------------- market intelligence & outreach
CREATE TABLE market_findings (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN ('trend','competitor','pricing')),
  title         TEXT NOT NULL,
  summary       TEXT NOT NULL DEFAULT '',
  competitor    TEXT,
  published_price TEXT,
  industry      TEXT,
  source_url    TEXT,
  researched_at TEXT NOT NULL,
  agent_id      TEXT REFERENCES agents(id),
  is_demo       INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL
);

CREATE TABLE prospects (
  id                  TEXT PRIMARY KEY,
  business_name       TEXT NOT NULL,
  industry            TEXT NOT NULL DEFAULT '',
  location            TEXT NOT NULL DEFAULT '',
  website             TEXT,
  public_contact      TEXT,                      -- published business channel only
  problem             TEXT NOT NULL DEFAULT '',
  qualification_score INTEGER CHECK (qualification_score BETWEEN 0 AND 100),
  source_url          TEXT,
  researched_at       TEXT,
  agent_id            TEXT REFERENCES agents(id),
  outreach_status     TEXT NOT NULL DEFAULT 'researched'
                      CHECK (outreach_status IN ('researched','drafted','awaiting_approval','approved','contacted','replied','meeting','qualified','not_interested','do_not_contact')),
  proposed_message    TEXT,
  approval_id         TEXT,
  meeting_at          TEXT,
  deal_value_cents    INTEGER,
  notes               TEXT NOT NULL DEFAULT '',
  is_demo             INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_prospects_dedupe ON prospects(lower(business_name), lower(location));

-- ---------------------------------------------------------------- automation runs (Make.com etc.)
CREATE TABLE workflow_runs (
  id            TEXT PRIMARY KEY,
  workflow      TEXT NOT NULL,
  external_id   TEXT,
  source        TEXT NOT NULL DEFAULT 'make',
  status        TEXT NOT NULL CHECK (status IN ('running','completed','failed')),
  started_at    TEXT,
  finished_at   TEXT,
  duration_ms   INTEGER,
  error         TEXT,
  payload       TEXT NOT NULL DEFAULT '{}',
  is_demo       INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  UNIQUE (source, external_id)
);
