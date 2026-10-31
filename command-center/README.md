# Fork Algorithm — Agent Command Center

A private control center where the founder supervises an AI Chief of Staff (**Atlas**) and eight department agents: Scout, Hunter, Compass, Forge, Echo, Harbor, Ledger and Sentinel. It tracks every unit of work as a task with logs and approvals. It shows real data from connected services and labels everything else as disconnected or demonstration data.

- **Deploying:** [DEPLOYMENT.md](./DEPLOYMENT.md)
- **What works today vs. what is disconnected or still to build:** [STATUS.md](./STATUS.md)

This app is separate from the public recipe site in the repository root. It is its own Worker (`fork-command-center`) with its own D1 database, so the two deploy independently.

## Architecture

```
Browser (React + TypeScript + Tailwind, built by Vite into dist/)
   │  same-origin fetch, HttpOnly session cookie, X-Requested-With header
   ▼
Cloudflare Worker  worker/index.ts
   ├─ /api/*            authenticated JSON API (routes.ts)   ── role checks, validation, rate limits, audit log
   ├─ /api/worker/*     external agent workers (external.ts) ── Bearer WORKER_TOKEN + owner opt-in
   ├─ /api/webhooks/make  Make.com run reports               ── HMAC-SHA256 or bearer secret
   ├─ scheduled()       cron: lease recovery, due tasks, Friday briefing (briefing.ts)
   └─ static assets     dist/ (single-page app fallback)
         │
         ├─ D1 (SQLite)   migrations/0001_init.sql, 0002_seed.sql
         └─ Adapters      integrations.ts  Anthropic · Make.com · Stripe · RingCentral · Google Sheets
                          executor.ts      in-Worker draft executor (Anthropic SDK)
```

| Path | Purpose |
|---|---|
| `shared/domain.ts` | Statuses, transitions, autonomy levels, capabilities. Shared by UI and API. |
| `worker/tasks.ts` | Task, approval and alert lifecycle. All state changes go through here. |
| `worker/routes.ts` | UI API endpoints |
| `worker/external.ts` | Worker API and Make.com webhook |
| `worker/integrations.ts` | One adapter per service, each with a status and a live test |
| `worker/executor.ts` | Runs a task through Claude and stores a **draft**. Never sends anything. |
| `worker/briefing.ts` | Weekly briefing aggregation and cron entry point |
| `worker/demo.ts` | Load and clear flagged demonstration data |
| `src/pages/*` | Overview, Chief of Staff, Agents, Tasks, Approvals, Market & Outreach, Workflows, Finance, Briefings, Alerts & Audit, Settings |
| `examples/external-worker.mjs` | Reference client for running an agent outside Cloudflare |

### How work flows

1. A task is created by the founder, an operator, or proposed by an agent's worker. It gets an ID like `TSK-20261031-7KQ2MX`. An optional idempotency key prevents duplicates.
2. Approval rules apply:
   - **Outreach, financial and access tasks always need founder approval.**
   - Supervised agents need approval for every task.
   - Observer agents can only hold proposals.
3. Approved or non-gated tasks become **scheduled**.
4. A backend claims the task atomically (**running**, with a lease):
   - the in-Worker executor (Anthropic provider), or
   - an external worker (`/api/worker/claim`).
5. The backend reports **completed** (with a result) or **failed** (with an error).
   - Retryable failures are rescheduled with exponential backoff, up to `max_attempts`.
   - When a lease lapses, cron requeues or fails the task.
6. Every step writes a task log line and an audit log entry. Final failures raise an alert.

Statuses: `proposed` → `awaiting_approval` → `scheduled` → `running` → `completed` | `failed`. A task can also be `paused` or `cancelled`. Allowed manual transitions are defined in `shared/domain.ts`.

### Capabilities are not access

A capability is **active** only when all three hold:

1. it is enabled on the agent,
2. the **owner** has authorized it, and
3. the backing integration has credentials.

Selecting a capability alone does nothing.

### Founder feedback

Like, Dislike, Modify and Hold on a recommendation are stored permanently. They update `founder_preferences` (`planning.agent.<id>`), which the executor includes as planning context. Protected settings (`limit.*`, `legal.*`, `access.*`) can only be changed by the owner on the Settings screen; feedback never changes them.

## Local development

```bash
cd command-center
npm install
cp .dev.vars.example .dev.vars          # local-only values the tests expect
npm run db:migrate:local
npm run build                           # build the UI into dist/
npx wrangler dev --test-scheduled       # API + UI on http://localhost:8787
# For hot reloading of the UI, run `npm run dev` (Vite on :5173, proxies /api to :8787).
```

### Tests

`tests/api.test.mjs` runs 15 end-to-end tests against the running local Worker. They cover:

- auth and CSRF checks, RBAC, input validation
- seeding of the nine agents and their reporting lines
- persistence of agent settings
- capability gating
- approval rules and decisions
- duplicate prevention and state transitions
- the full external-worker lifecycle, including retry and backoff
- Make.com signature verification and dedupe
- protection of limits from founder feedback
- isolation of demo data from briefings
- disconnected integration states
- the cron handler

```bash
# with `wrangler dev --test-scheduled` running and .dev.vars copied from .dev.vars.example
npm test
```

The tests expect **no** integration secrets other than `MAKE_WEBHOOK_SECRET`, so they can verify the disconnected states.
