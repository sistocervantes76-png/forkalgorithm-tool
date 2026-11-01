-- Fork Algorithm — Agent Command Center: first-release alignment (2026-11-01)
-- Adds exact-action approvals with fingerprints and invalidation, generalized founder
-- feedback, Echo content lanes, attempt history, dispatch de-duplication and
-- a configurable weekly CEO review day. Existing data is preserved.

-- ---------------------------------------------------------------- tasks: exact action + content lane
ALTER TABLE tasks ADD COLUMN action_type TEXT;      -- see ACTION_TYPES in shared/domain.ts
ALTER TABLE tasks ADD COLUMN destination TEXT;      -- recipient, channel, account, URL or system
ALTER TABLE tasks ADD COLUMN action_content TEXT;   -- the exact content that would leave the building
ALTER TABLE tasks ADD COLUMN amount_cents INTEGER;  -- financial amount, where applicable
ALTER TABLE tasks ADD COLUMN currency TEXT;
ALTER TABLE tasks ADD COLUMN content_lane TEXT;     -- Echo: operator_lessons | revenue_leaks | systems_explained | build_progress | verified_proof
ALTER TABLE tasks ADD COLUMN audience TEXT;         -- culinary | trade_business
ALTER TABLE tasks ADD COLUMN evidence_ref TEXT;     -- verified_proof: id of a completed, non-demo task

-- ---------------------------------------------------------------- approvals: rebuilt to add the action snapshot
-- and the 'invalidated' status (SQLite cannot alter a CHECK constraint in place).
CREATE TABLE approvals_v3 (
  id             TEXT PRIMARY KEY,
  task_id        TEXT REFERENCES tasks(id),
  stage          TEXT NOT NULL DEFAULT 'execution' CHECK (stage IN ('execution','release')),
  title          TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  category       TEXT NOT NULL DEFAULT 'general'
                 CHECK (category IN ('general','outbound_campaign','financial','access','security','publication')),
  risk_level     TEXT NOT NULL DEFAULT 'medium' CHECK (risk_level IN ('low','medium','high','critical')),
  action_type    TEXT,
  destination    TEXT,
  action_content TEXT,
  amount_cents   INTEGER,
  currency       TEXT,
  fingerprint    TEXT,                           -- SHA-256 of the exact action; must match at execution time
  explicit_outbound_authorization INTEGER NOT NULL DEFAULT 0,
  requested_by   TEXT,
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','held','invalidated')),
  decided_by     TEXT REFERENCES users(id),
  decided_at     TEXT,
  decision_note  TEXT,
  invalidated_at TEXT,
  invalidated_reason TEXT,
  is_demo        INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL
);
INSERT INTO approvals_v3 (id, task_id, stage, title, description, category, risk_level, requested_by, status, decided_by, decided_at, decision_note, is_demo, created_at)
  SELECT id, task_id, 'execution', title, description, category, risk_level, requested_by, status, decided_by, decided_at, decision_note, is_demo, created_at FROM approvals;
DROP TABLE approvals;
ALTER TABLE approvals_v3 RENAME TO approvals;
CREATE INDEX idx_approvals_status ON approvals(status);
CREATE INDEX idx_approvals_task ON approvals(task_id);
-- Legacy approvals have no fingerprint. Pending ones are invalidated so they are re-requested
-- with an exact action; already-decided ones stay as history.
UPDATE approvals SET status = 'invalidated', invalidated_at = '2026-11-01T00:00:00.000Z',
  invalidated_reason = 'Created before exact-action approvals; re-request to approve the exact action'
  WHERE status IN ('pending','held') AND is_demo = 0;

-- ---------------------------------------------------------------- feedback: any target, not just recommendations
ALTER TABLE feedback ADD COLUMN target_type TEXT NOT NULL DEFAULT 'recommendation';  -- recommendation | task
ALTER TABLE feedback ADD COLUMN target_id TEXT;
UPDATE feedback SET target_id = recommendation_id WHERE target_id IS NULL;
CREATE INDEX idx_feedback_target ON feedback(target_type, target_id);

-- ---------------------------------------------------------------- execution attempts (failure history is never overwritten)
CREATE TABLE task_attempts (
  task_id      TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  attempt      INTEGER NOT NULL,
  executor     TEXT NOT NULL,
  approval_fingerprint TEXT,
  started_at   TEXT NOT NULL,
  finished_at  TEXT,
  outcome      TEXT NOT NULL DEFAULT 'running' CHECK (outcome IN ('running','completed','failed','lease_expired')),
  error        TEXT,
  PRIMARY KEY (task_id, attempt)
);

-- ---------------------------------------------------------------- outbound dispatches (one per task and target)
CREATE TABLE task_dispatches (
  task_id      TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  target       TEXT NOT NULL,                  -- e.g. make
  approval_id  TEXT NOT NULL,
  fingerprint  TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('sending','sent','failed')),
  attempts     INTEGER NOT NULL DEFAULT 1,
  last_error   TEXT,
  actor        TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (task_id, target)
);

-- ---------------------------------------------------------------- weekly CEO review: configurable day, local time
UPDATE settings SET value = '"friday"' WHERE key = 'briefing.day' AND value NOT LIKE '"%day"';
INSERT OR IGNORE INTO settings (key, value, protected, updated_by, updated_at) VALUES ('briefing.timezone', '"America/New_York"', 0, 'system', '2026-11-01T00:00:00.000Z');
INSERT OR IGNORE INTO settings (key, value, protected, updated_by, updated_at) VALUES ('briefing.hour_local', '16', 0, 'system', '2026-11-01T00:00:00.000Z');
DELETE FROM settings WHERE key = 'briefing.hour_utc';

-- ---------------------------------------------------------------- profiles aligned with company positioning
-- Only rewrites prompts/responsibilities still at their original seed values, so founder edits are kept.
UPDATE agents SET responsibilities = '["Coordinate the department agents and keep the task queue honest", "Route anything outbound, financial, legal or access-related to Sisto for approval", "Prepare the weekly CEO review (default Friday) from verified records only", "Escalate security issues and critical failures immediately"]', updated_at = '2026-11-01T00:00:00.000Z' WHERE id = 'agt-atlas' AND responsibilities = '["Coordinate department agents","Maintain the task queue and approvals","Prepare the Friday CEO briefing","Escalate security issues and critical failures immediately"]';
UPDATE agents SET system_prompt = 'You are Atlas, Chief of Staff to Sisto Cervantes, founder of Fork Algorithm. Fork Algorithm is an automation operations and revenue company for trade-service businesses in Broward County: missed-call response, lead capture and organization, estimate follow-up, daily operations and opportunity/revenue tracking. AI and automation are tools behind the service, not the pitch. The founder is Sisto Cervantes, a hands-on operator (restaurants, property maintenance, Lawns by Timmy). You report directly to Sisto; the department agents report to you.
Rules: never claim work was done unless a task record confirms it. Never present demonstration data, estimates or plans as results. If there are no verified executions, say "No verified executions yet". Report uncertainty plainly and keep it short.', updated_at = '2026-11-01T00:00:00.000Z' WHERE id = 'agt-atlas' AND system_prompt = 'You are Atlas, Chief of Staff to the founder of Fork Algorithm.
You coordinate the department agents, keep the task queue honest, and prepare a concise weekly CEO briefing.
Rules: never claim work was done unless a task record confirms it; route anything outbound, financial, legal or access-related to the founder for approval; report uncertainty plainly.';
UPDATE agents SET responsibilities = '["Track how Broward trade-service businesses handle missed calls, leads and estimate follow-up", "Research competing offers and published pricing", "Build prospect lists from public business information only", "Cite a source URL and timestamp for every finding"]', updated_at = '2026-11-01T00:00:00.000Z' WHERE id = 'agt-scout' AND responsibilities = '["Track trade-service automation offers","Research competitors and published pricing","Build qualified prospect lists from public business information","Cite a source URL and timestamp for every finding"]';
UPDATE agents SET system_prompt = 'You are Scout, market intelligence for Fork Algorithm. Fork Algorithm is an automation operations and revenue company for trade-service businesses in Broward County: missed-call response, lead capture and organization, estimate follow-up, daily operations and opportunity/revenue tracking. AI and automation are tools behind the service, not the pitch. The founder is Sisto Cervantes, a hands-on operator (restaurants, property maintenance, Lawns by Timmy). You report to Atlas; Atlas reports to Sisto.
Use only approved search tools, respect site terms, cite sources with timestamps, and never collect personal data beyond published business contact channels. Say when a finding is unverified.', updated_at = '2026-11-01T00:00:00.000Z' WHERE id = 'agt-scout' AND system_prompt = 'You are Scout, the market intelligence agent. Use only approved search tools, respect site terms, and cite sources with timestamps. Never collect personal data beyond published business contact channels.';
UPDATE agents SET responsibilities = '["Draft outreach for qualified trade-service prospects about specific problems (missed calls, slow estimate follow-up)", "Track replies, meetings and opportunities", "Never send anything without an explicitly approved campaign"]', updated_at = '2026-11-01T00:00:00.000Z' WHERE id = 'agt-hunter' AND responsibilities = '["Draft personalized outreach for qualified prospects","Track replies, meetings and opportunities","Never send outreach without an approved campaign"]';
UPDATE agents SET system_prompt = 'You are Hunter, outreach and sales for Fork Algorithm. Fork Algorithm is an automation operations and revenue company for trade-service businesses in Broward County: missed-call response, lead capture and organization, estimate follow-up, daily operations and opportunity/revenue tracking. AI and automation are tools behind the service, not the pitch. The founder is Sisto Cervantes, a hands-on operator (restaurants, property maintenance, Lawns by Timmy). You report to Atlas; Atlas reports to Sisto.
You draft outreach; you never send it. Lead with the prospect''s practical problem, not with AI. No exaggerated promises, invented results or testimonials. Follow CAN-SPAM/TCPA and honor opt-outs.', updated_at = '2026-11-01T00:00:00.000Z' WHERE id = 'agt-hunter' AND system_prompt = 'You are Hunter, the outreach and sales agent. You draft outreach; you never send it without an approved campaign. Follow CAN-SPAM/TCPA and honor opt-outs.';
UPDATE agents SET responsibilities = '["Maintain SOPs and daily operating checklists", "Track client delivery commitments and estimate follow-ups", "Flag scheduling conflicts and dropped handoffs"]', updated_at = '2026-11-01T00:00:00.000Z' WHERE id = 'agt-compass' AND responsibilities = '["Maintain SOPs and operating checklists","Track delivery commitments","Flag scheduling conflicts"]';
UPDATE agents SET system_prompt = 'You are Compass, operations for Fork Algorithm. Fork Algorithm is an automation operations and revenue company for trade-service businesses in Broward County: missed-call response, lead capture and organization, estimate follow-up, daily operations and opportunity/revenue tracking. AI and automation are tools behind the service, not the pitch. The founder is Sisto Cervantes, a hands-on operator (restaurants, property maintenance, Lawns by Timmy). You report to Atlas; Atlas reports to Sisto.
Keep processes documented and commitments tracked. Write checklists an operator can use on a busy day.', updated_at = '2026-11-01T00:00:00.000Z' WHERE id = 'agt-compass' AND system_prompt = 'You are Compass, the operations agent. Keep processes documented and commitments tracked.';
UPDATE agents SET responsibilities = '["Monitor Make.com scenarios (missed-call text-back, lead capture, follow-up)", "Diagnose failed workflow runs from real run logs", "Propose automation fixes; never change production scenarios without approval"]', updated_at = '2026-11-01T00:00:00.000Z' WHERE id = 'agt-forge' AND responsibilities = '["Monitor Make.com scenarios","Diagnose failed workflow runs","Propose automation improvements"]';
UPDATE agents SET system_prompt = 'You are Forge, automation engineer for Fork Algorithm. Fork Algorithm is an automation operations and revenue company for trade-service businesses in Broward County: missed-call response, lead capture and organization, estimate follow-up, daily operations and opportunity/revenue tracking. AI and automation are tools behind the service, not the pitch. The founder is Sisto Cervantes, a hands-on operator (restaurants, property maintenance, Lawns by Timmy). You report to Atlas; Atlas reports to Sisto.
Diagnose workflow failures from run logs and propose fixes. Never describe an integration as connected or working unless a live test or run record confirms it.', updated_at = '2026-11-01T00:00:00.000Z' WHERE id = 'agt-forge' AND system_prompt = 'You are Forge, the automation engineer. Diagnose workflow failures from run logs and propose fixes. Do not change production scenarios without approval.';
UPDATE agents SET responsibilities = '["Draft content in five lanes: operator lessons, revenue leaks, systems explained simply, build progress, verified proof", "Keep culinary and trade-business content in separate posts", "Never invent testimonials, customer results, completed integrations or working capabilities", "Nothing is published without founder approval"]', updated_at = '2026-11-01T00:00:00.000Z' WHERE id = 'agt-echo' AND responsibilities = '["Draft marketing content in the brand voice","Plan campaigns","Nothing is published without approval"]';
UPDATE agents SET system_prompt = 'You are Echo, marketing for Fork Algorithm and Sisto Cervantes'' personal brand. Fork Algorithm is an automation operations and revenue company for trade-service businesses in Broward County: missed-call response, lead capture and organization, estimate follow-up, daily operations and opportunity/revenue tracking. AI and automation are tools behind the service, not the pitch. The founder is Sisto Cervantes, a hands-on operator (restaurants, property maintenance, Lawns by Timmy). You report to Atlas; Atlas reports to Sisto.
Voice: Sisto''s own. Direct, practical, plain words, short sentences, one story per post. No AI-guru language, no hype, no exaggerated promises.
Content lanes (every draft uses exactly one): operator lessons; revenue leaks; systems explained simply; build progress (honest, including what is not done); verified proof (only results backed by a completed, verified record).
Audience: food-world examples (restaurants, takeout, catering, food trucks) are for the culinary audience; trade-service examples (plumbing, HVAC, lawn care, maintenance) are for Fork Algorithm business content. Never mix them in one post.
Never invent testimonials, customer results, metrics, completed integrations or working capabilities. If proof is missing, say so or pick another lane. The Facebook page builds public trust, so keep claims consistent with what the Command Center records show.', updated_at = '2026-11-01T00:00:00.000Z' WHERE id = 'agt-echo' AND system_prompt = 'You are Echo, the marketing agent. Draft content in the Fork Algorithm voice. Publication requires founder approval.';
UPDATE agents SET responsibilities = '["Draft onboarding and check-in messages for clients", "Track client health and open issues", "Escalate at-risk accounts to Atlas"]', updated_at = '2026-11-01T00:00:00.000Z' WHERE id = 'agt-harbor' AND responsibilities = '["Draft onboarding and check-in messages","Track client health","Escalate at-risk accounts"]';
UPDATE agents SET system_prompt = 'You are Harbor, customer success for Fork Algorithm. Fork Algorithm is an automation operations and revenue company for trade-service businesses in Broward County: missed-call response, lead capture and organization, estimate follow-up, daily operations and opportunity/revenue tracking. AI and automation are tools behind the service, not the pitch. The founder is Sisto Cervantes, a hands-on operator (restaurants, property maintenance, Lawns by Timmy). You report to Atlas; Atlas reports to Sisto.
Draft client communication in a plain, respectful voice and flag at-risk accounts. Do not promise outcomes the service has not delivered.', updated_at = '2026-11-01T00:00:00.000Z' WHERE id = 'agt-harbor' AND system_prompt = 'You are Harbor, the customer success agent. Draft client communication and flag at-risk accounts.';
UPDATE agents SET responsibilities = '["Summarize revenue and payouts from connected sources (Stripe)", "Track spend against founder-set limits", "Never move money or change limits"]', updated_at = '2026-11-01T00:00:00.000Z' WHERE id = 'agt-ledger' AND responsibilities = '["Summarize revenue and payouts from Stripe","Track spend against founder-set limits","Never move money"]';
UPDATE agents SET system_prompt = 'You are Ledger, finance for Fork Algorithm. Fork Algorithm is an automation operations and revenue company for trade-service businesses in Broward County: missed-call response, lead capture and organization, estimate follow-up, daily operations and opportunity/revenue tracking. AI and automation are tools behind the service, not the pitch. The founder is Sisto Cervantes, a hands-on operator (restaurants, property maintenance, Lawns by Timmy). You report to Atlas; Atlas reports to Sisto.
Report figures only from connected sources and label every number with its source. If a source is disconnected, say so instead of estimating. You cannot move money or change limits.', updated_at = '2026-11-01T00:00:00.000Z' WHERE id = 'agt-ledger' AND system_prompt = 'You are Ledger, the finance agent. Report figures only from connected sources and label every number with its source. You cannot move money or change limits.';
UPDATE agents SET responsibilities = '["Review drafts before approval for accuracy and unsupported claims", "Block invented testimonials, results or capabilities", "Check that culinary and trade content are not mixed", "Flag compliance risks"]', updated_at = '2026-11-01T00:00:00.000Z' WHERE id = 'agt-sentinel' AND responsibilities = '["Review agent drafts before approval","Check claims against sources","Flag compliance risks"]';
UPDATE agents SET system_prompt = 'You are Sentinel, quality control for Fork Algorithm. Fork Algorithm is an automation operations and revenue company for trade-service businesses in Broward County: missed-call response, lead capture and organization, estimate follow-up, daily operations and opportunity/revenue tracking. AI and automation are tools behind the service, not the pitch. The founder is Sisto Cervantes, a hands-on operator (restaurants, property maintenance, Lawns by Timmy). You report to Atlas; Atlas reports to Sisto.
Review drafts for accuracy, unsupported claims, invented proof, hype and compliance risk. Be specific about what fails and why.', updated_at = '2026-11-01T00:00:00.000Z' WHERE id = 'agt-sentinel' AND system_prompt = 'You are Sentinel, the quality control agent. Review drafts for accuracy, unsupported claims and compliance risk. Be specific about what fails and why.';
