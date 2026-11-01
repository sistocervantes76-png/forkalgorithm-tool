# First-release alignment review (2026-11-01)

The founder's request asked for a review of the Agent Command Center against Fork Algorithm's positioning and operating rules, then a first working release. The detailed specification referenced in the request was not attached (the message ended with a placeholder), so this release is built from the rules written in the request itself. The first build (PR #10) was kept and refined, not replaced.

## Positioning used

- Fork Algorithm is an automation operations and revenue company for trade-service businesses. Lead with outcomes: missed-call response, lead capture and organization, estimate follow-up, daily operations, opportunity and revenue tracking. AI is a tool behind the service.
- Sisto Cervantes is a hands-on operator (restaurants, property maintenance, Lawns by Timmy). The Facebook page builds public trust; the Command Center manages the business behind it. Claims must match what the records show.
- No invented testimonials, results, metrics, completed integrations or working capabilities. Use "No verified executions yet" where that is the truth.

## Gaps found in the first build, and what changed

| Gap | Change |
|---|---|
| Approvals named a task, not an exact action. Nothing recorded destination, content or amount. | Approvals snapshot action type, destination, exact content, amount and currency with a SHA-256 fingerprint. |
| Approving an outreach task let its later result be dispatched, so the sent content was never approved. | Two stages: execution (may this run) and release (may this exact content go to this destination). Dispatch requires a valid release approval. |
| Tasks could not be edited, and nothing invalidated an approval when work changed. | `PATCH /api/tasks/:id`. Material edits invalidate live approvals and re-request approval. Claim, retry, resume and dispatch re-check the fingerprint. |
| Outbound campaigns needed only a click. | Real sends need explicit authorization recorded on the approval. |
| Financial limits were recorded but nothing checked amounts. | Financial approvals need an amount and are refused above `limit.max_transaction_usd` (default $0). Only the owner's settings change raises it. |
| Dispatch de-duplication searched log text (racy). | `task_dispatches` row per task and target, claimed before sending; failures are recorded and retried only explicitly. |
| Failure history was overwritten by the next attempt. | `task_attempts` keeps every attempt and its outcome. Retries add one attempt at a time. |
| Feedback worked only on recommendations. | Like / Dislike / Modify / Hold on tasks too, with history per task. Still planning preferences only. |
| Weekly briefing was fixed to Friday 21:00 UTC by cron; the setting was read-only. | Day, hour and time zone are settings (default Friday 16:00 New York). One 15-minute cron checks it. |
| Integration labels said "Disconnected" for missing secrets and "Configured, untested" otherwise. | Not configured / Configured, not verified / Connected (verified) / Disconnected (test failed). Receive-only integrations count as connected only after a verified contact. |
| "Enabled" profiles looked active; executor ran with an untested API key. | Five-point readiness check per agent. In-Worker execution needs the Anthropic live test to pass. |
| Echo had no content lanes or audience rule. | Lanes and audience required for Echo drafts; verified proof needs a completed, non-demo evidence task. Echo's prompt carries the voice and no-invention rules. |
| Agent prompts described a generic "AI Chief of Staff". | Prompts state the company's outcomes, the founder, and the reporting line; rewritten only where still at seed text. |
| Integrations were one file. | `worker/adapters/` with one module per provider and an AI provider registry. |
| Later-phase workspaces sat beside core workflows. | Grouped under "Later phase" in navigation with a banner; removed from the overview. |
| `wrangler` commands picked up the public site's root `wrangler.jsonc`. | npm scripts pass `-c wrangler.toml`; DEPLOYMENT.md says to do the same. |

## Conflicts flagged (none blocking)

- **Hold on a task.** The request lists Hold as feedback. It is stored as feedback and does not pause the task, because feedback must not silently change operations. Use Pause for that.
- **Approving outreach to draft vs. to send.** Approving an outreach task authorizes drafting only. The explicit outbound authorization is asked at release, where the exact content exists.

## Architecture

```
React + TypeScript + Tailwind (Vite)  ──fetch──▶  Cloudflare Worker (worker/index.ts)
                                                   ├─ routes.ts      UI API, role checks on every write
                                                   ├─ tasks.ts       task, approval, release, attempt lifecycle
                                                   ├─ executor.ts    readiness checks, in-Worker draft executor
                                                   ├─ external.ts    worker API, Make.com inbound webhook
                                                   ├─ briefing.ts    weekly CEO review + 15-min cron
                                                   ├─ integrations.ts + adapters/*   Make, RingCentral, Stripe, Google Sheets, AI
                                                   └─ D1 (SQLite)    migrations/0001..0003
Secrets: Worker secrets only. Never in D1, never sent to the browser.
```

## Schema added in 0003

- `tasks`: `action_type`, `destination`, `action_content`, `amount_cents`, `currency`, `content_lane`, `audience`, `evidence_ref`.
- `approvals` (rebuilt): `stage` (execution | release), the same action fields, `fingerprint`, `explicit_outbound_authorization`, `invalidated_at`, `invalidated_reason`, status adds `invalidated`.
- `feedback`: `target_type` (recommendation | task), `target_id`.
- `task_attempts` (task_id, attempt) PK: executor, approval fingerprint, outcome, error, timestamps.
- `task_dispatches` (task_id, target) PK: approval, fingerprint, status, attempts, last error.
- settings: `briefing.timezone`, `briefing.hour_local`; `briefing.hour_utc` removed.
