# Status: what is functional, simulated, disconnected, or unimplemented

Last updated with the initial build. "Functional" means it is implemented and covered by the end-to-end tests in `tests/api.test.mjs`, or verified in the browser.

## Functional

| Area | Notes |
|---|---|
| Sign-in, sessions, RBAC | Owner from env secrets; other users stored with PBKDF2 hashes. Roles: owner, admin, operator, viewer. HttpOnly + SameSite=Strict cookie plus a CSRF header check. |
| Rate limiting | Logins (per IP and per email), writes per user, worker API, webhook. Repeated login failures raise a security alert. |
| Audit log | Every state change records actor, action, entity, details and IP. |
| Agent profiles | Nine seeded agents with reporting lines: Atlas reports to the founder; the others report to Atlas. Custom agents and departments can be added. You can rename, change icon/accent/nameplate style, edit responsibilities, prompt, provider/model, autonomy, priority, authority (owner only), schedule, enable/pause, and replace. |
| Capability gating | Requested + owner-authorized + credentials present. The blocked reason is shown for each capability. |
| Tasks | IDs, statuses, transitions, logs, timestamps, attempts, idempotency keys, pause/resume/cancel/retry, notes. |
| Approvals | Created automatically for outreach, financial and access tasks, supervised agents, explicit requests and prospect outreach. Approve, reject or hold, with notes. |
| Safe failure recovery | Execution leases. Expired leases are retried with backoff or marked failed; final failures raise alerts. |
| External worker API | Claim, log, complete and fail, plus proposals and recommendations. Off until the owner enables it. |
| Make.com inbound | Signed webhook that records runs (deduplicated) and raises an alert per failure. |
| Chief of Staff panel | Department workload, completed and failed work, approvals, opportunities, incidents, recommendations, and the feedback history. |
| Founder feedback | Like, Dislike, Modify (note required) and Hold. Updates planning preferences only; protected limits are untouched (tested). |
| Weekly CEO briefing | Aggregated from real records every Friday by cron, or on demand. Demonstration data is excluded. |
| Market & outreach workspace | Prospects with filters (industry, location, problem, score, status), sources and timestamps, draft messages, an approval request, a pipeline board, and market findings (trends, competitors, published pricing). |
| Workflows page | Runs per day, failures, and per-workflow success rate and duration from reported runs. |
| Settings | Integration status with live tests, policies and protected limits, users and roles, demonstration data. |
| Responsive UI | Desktop sidebar and mobile drawer navigation. Checked for horizontal overflow at 375px on every page. |

## Built but untested against live services (disconnected until secrets are added)

These adapters are written against each provider's documented API. They have **not** been exercised against real accounts in this build, because no credentials were available. Each one reports *Disconnected* until its secrets are set, and only shows *Connected* after a successful **Test connection**.

| Integration | What the code does |
|---|---|
| Anthropic | Test: `GET /v1/models`. Executor: runs a scheduled task through the official SDK (default `claude-opus-5-5`, with server-side refusal fallback) and stores the output as a labelled **draft**. Uses web search only when the agent's Web research capability is active. Optional narrative for the briefing. |
| Stripe | Test and Finance page: `GET /v1/balance`, plus charges from the last 30 days (first 100). Read-only. |
| Make.com outbound | Signed POSTs for alerts in the immediate categories and for "Dispatch to Make.com" on approved, completed tasks. Dispatch is owner-only and happens at most once per task. |
| RingCentral | Test only: JWT grant token exchange. |
| Google Sheets | Test: reads the spreadsheet title with a service-account JWT. A `readSheetRange` helper exists but no screen uses it yet. |

## Simulated (demonstration data)

**Settings → Demonstration data** can load sample tasks, approvals, prospects, findings, workflow runs, an alert and a recommendation. Safeguards:

- every row has `is_demo = 1`;
- domains are `example.com`, and names carry "(demo)" or a "DEMO —" prefix;
- every row shows a DEMO badge;
- the rows are hidden unless the viewer switches on "Show demonstration data";
- they cannot be approved, executed or dispatched;
- they are excluded from briefings.

Nothing else in the app is simulated.

## Not implemented yet

- **Sending outreach.** Approved outreach is not sent automatically. Send it yourself or through an approved Make.com scenario, then mark the prospect *contacted*. Daily outbound caps (`limit.outbound_messages_per_day`) are recorded but not enforced yet, because nothing sends.
- **Automated research.** Scout does not crawl or search on its own. Findings and prospects are entered manually or by an external worker. The executor can draft research with Claude's web search if authorized, but it does not write prospects into the database.
- **Multi-step Chief of Staff delegation.** Atlas can propose tasks for other agents through the worker API, and humans advance them. There is no autonomous plan-and-delegate loop running inside the Worker.
- **RingCentral calling and SMS**, Google Sheets **writes** (the CRM updates capability), and email sending.
- **AI spend tracking.** `limit.monthly_ai_spend_usd` is recorded only. Enforce it with a spend cap in the Anthropic Console.
- **Other AI providers.** The provider field is modular (`none`, `anthropic`, `custom-worker`); others can run as external workers.
- **Email or push delivery of alerts** without Make.com. Alerts appear in-app; immediate notifications need the Make.com outbound webhook.
- **Password reset and 2FA.** Use Cloudflare Access in front of the app for strong authentication (see DEPLOYMENT.md §5).
