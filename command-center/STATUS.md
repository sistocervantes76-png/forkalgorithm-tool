# Status: functional, demonstrated, disconnected, unimplemented

Last updated 2026-11-01 for the first release. "Functional" means implemented and covered by the 24 end-to-end tests in `tests/` (run against a local Worker with a local D1 database), or checked in the browser. **Nothing here has been deployed or tested against live third-party accounts from this build.**

## Functional (first-release scope)

| # | Feature | What works |
|---|---|---|
| 1 | Authentication and founder access | Owner account from Worker secrets (`OWNER_EMAIL`, `OWNER_PASSWORD`, optional `OWNER_NAME`). Other users use PBKDF2 hashes. Roles: owner, admin, operator, viewer. HttpOnly SameSite=Strict cookie plus a CSRF header. Login and write rate limits. Every protected action checks the role on the backend. |
| 2 | Agent profiles and settings | Nine profiles (Atlas reports to the founder; the other eight report to Atlas). Name, nameplate, icon, accent, responsibilities, prompt, provider, model, autonomy, priority, authority, schedule, enable/pause/replace. Persisted in D1 and audited. Prompts are aligned with Fork Algorithm positioning (migration 0003 only rewrites prompts still at their original seed text). |
| — | Execution readiness | Each agent shows five checks: profile enabled, backend configured, **verified** credentials (live test passed), tools authorized, allowed to execute. Enabling a profile alone shows "Not running". Capabilities need request + owner grant + credentials. |
| 3 | Tasks | IDs, assignment, statuses, transitions, timestamps, logs, results, idempotency keys. Editing via `PATCH /api/tasks/:id`; running tasks cannot be edited; completed tasks can only change their outbound action. |
| — | Duplicate prevention | Atomic claim guarded by status **and** `updated_at` (no edit can slip between check and claim), plus a primary key per attempt. Dispatches are one row per task and target; a second send is refused. |
| — | Attempt history and retries | `task_attempts` keeps every attempt with executor, outcome (`completed`, `failed`, `lease_expired`) and error. Manual retry adds exactly one attempt and is refused if the approval no longer covers the task. Automatic retries use exponential backoff. |
| 4 | CEO approvals tied to exact actions | Approvals snapshot the action type, destination, exact content and amount, with a SHA-256 fingerprint. A material edit invalidates every live approval for the task and requests a new one. Execution and dispatch re-check the fingerprint. Two stages: **execution** (may this task run) and **release** (may this exact result leave the building). |
| — | Outbound and financial rules | Real sends (`send_message`, `outbound_campaign`, release-stage outreach) need explicit authorization on the approval. Financial approvals must state an amount and are refused above the protected `limit.max_transaction_usd` (default $0). Approvals never raise limits. |
| 5 | Founder feedback | Like / Dislike / Modify (note required) / Hold on recommendations **and tasks**, stored permanently. Updates `planning.agent.<id>` preferences only. Tests confirm capabilities, autonomy, authority and protected settings are unchanged. Hold does not pause work. |
| 6 | Audit history | Every state change: actor, action, entity, details, IP. Includes approval invalidations, release requests, dispatch failures and feedback. |
| 7 | Weekly CEO review | Default Friday 16:00 America/New_York; day, hour and time zone are settings. Built from real records only (demonstration data excluded). Includes verified executions ("No verified executions yet" when zero), approvals voided by changes, agent readiness, and completed results awaiting feedback. |
| 8 | Integration states | Not configured (secrets missing), Configured not verified, Connected (verified: live test passed or a verified inbound contact arrived), Disconnected (last test failed). Demonstration records carry a DEMO badge. |
| — | Echo content lanes | Echo drafts must name one lane (operator lessons, revenue leaks, systems explained simply, build progress, verified proof) and one audience (culinary or trade-service business). Verified proof must reference a completed, non-demo task. Enforced on the backend. |
| — | Make.com inbound | Signed webhook records runs (deduplicated by execution id) and raises an alert per failure. |

## Demonstrated (sample data only)

**Settings → Demonstration data** loads flagged sample tasks, approvals, prospects, findings, workflow runs, an alert and a recommendation. Every row has `is_demo = 1`, uses example.com, shows a DEMO badge, is hidden unless "Show demonstration data" is on, cannot be approved, executed, dispatched or used as proof, and is excluded from the weekly review and feedback. Nothing else is simulated.

## Disconnected (code written, never exercised against a live account)

Each shows **Not configured** until its secrets are set, and **Connected** only after a successful live test.

| Integration | What the code does |
|---|---|
| Anthropic | Live test `GET /v1/models`. In-Worker executor writes a labelled **draft** (no tools that act outside; optional web search if authorized). Optional review narrative. |
| Make.com outbound | Signed POSTs for immediate alerts and for dispatching a release-approved action (owner only, once per task, explicit retry after failure). |
| Stripe | Read-only balance and last-30-day charges. Cannot move money. |
| RingCentral | Credential check only (JWT token exchange). |
| Google Sheets | Credential check (reads the spreadsheet title). A `readSheetRange` helper exists; nothing uses it yet. |
| External worker API | Claim, log, complete, fail, propose. Off until the owner enables it. Tested locally with a simulated worker. |

## Not implemented yet

- **Deployment.** Nothing in this release has been deployed. See DEPLOYMENT.md.
- **Missed-call recovery itself.** RingCentral call logs, missed-call detection and text-back are not built. The Command Center tracks the work; the customer-facing automations live in Make.com.
- **Sending without Make.com.** No direct email, SMS or social posting. Approved actions go out only through a Make.com scenario.
- **Lead and estimate tracking, revenue tracking.** No lead or estimate records yet; Finance shows Stripe only. These are later-phase workspaces.
- **Daily outbound cap enforcement** (`limit.outbound_messages_per_day`) and **AI spend enforcement** (`limit.monthly_ai_spend_usd`): recorded, not enforced, because nothing sends in bulk. Use a spend cap in the Anthropic Console.
- **Autonomous Atlas delegation loop.** Atlas and workers can propose tasks; humans advance them.
- **Other AI providers in the Worker.** The provider registry (`worker/adapters/ai.ts`) is ready for more; today other providers run as external workers.
- **Password reset and 2FA.** Put Cloudflare Access in front (DEPLOYMENT.md §5).
- **Later-phase workspaces** (Market & Outreach, Workflows, Finance) exist from the first build and use only real records, but are labelled "Later phase" and were not reviewed in this release.
