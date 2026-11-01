# Deploying the Command Center to Cloudflare

All commands run from `command-center/`. You need a Cloudflare account and Node 20+.

> **Always pass `-c wrangler.toml`** to wrangler commands you type by hand (the npm scripts already do). The repository root has its own `wrangler.jsonc` for the public site, and wrangler 4 otherwise picks that one up and cannot find the D1 database.

## 1. Install and sign in

```bash
cd command-center
npm install
npx wrangler login
```

## 2. Create the D1 database

```bash
npx wrangler d1 create fork-command-center
```

Copy the printed `database_id` into `wrangler.toml`. The value already in the file was added by the first build; confirm it exists in your account with `npx wrangler d1 list` before reusing it. Then apply the migrations (0001 schema, 0002 seed, 0003 first-release alignment):

```bash
npx wrangler d1 export fork-command-center --remote -c wrangler.toml --output backup-before-0003.sql   # if the database already has data
npm run db:migrate:remote
```

Migration 0003 rebuilds the `approvals` table to add exact-action fields, and marks any still-pending legacy approval as invalidated so it is re-requested with an exact action. It rewrites agent prompts only where they still match the original seed text, so any edits you made are kept.

The seed contains configuration only: departments, the nine agent profiles (all **disabled**, no capabilities authorized) and default settings. It contains no tasks or results.

## 3. Set secrets

Secrets live only in Cloudflare. They never reach the browser or the database.

**Required**

```bash
npx wrangler secret put OWNER_PASSWORD     # long, unique passphrase
npx wrangler secret put WORKER_TOKEN       # e.g. `openssl rand -base64 32`
```

Optionally set `OWNER_NAME` (for example `Sisto Cervantes`) as a variable; it is the display name on the founder account.

Set `OWNER_EMAIL` as a secret (`npx wrangler secret put OWNER_EMAIL`) or as a variable in the dashboard; `keep_vars = true` in `wrangler.toml` keeps dashboard variables across deploys. Signing in with that email and `OWNER_PASSWORD` creates or refreshes the single **owner** account. Add other users (admin, operator, viewer) in **Settings → Users & roles**.

**Optional — add each only when you have the access. Until then the integration shows as Not configured. With secrets set it shows "Configured, not verified" until a live test passes (or, for receive-only integrations, until a verified contact arrives).**

| Secret(s) | Enables |
|---|---|
| `ANTHROPIC_API_KEY` | In-Worker draft executor and the AI narrative in briefings. Set a spend cap in the Anthropic Console too. |
| `MAKE_WEBHOOK_SECRET` | Inbound Make.com run reports at `/api/webhooks/make` |
| `MAKE_OUTBOUND_WEBHOOK_URL` | Immediate alert notifications and "Dispatch to Make.com" for tasks with an approved release (signed with `MAKE_WEBHOOK_SECRET` when set) |
| `STRIPE_SECRET_KEY` | Read-only balance and charges on the Finance page. Use a **restricted key** with read access to Balance and Charges only. |
| `RINGCENTRAL_CLIENT_ID`, `RINGCENTRAL_CLIENT_SECRET`, `RINGCENTRAL_JWT` (optional `RINGCENTRAL_SERVER_URL`) | Credential check only, for now |
| `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_SHEETS_ID` | Google Sheets access. Share the sheet with the service account's email. |

```bash
npx wrangler secret put STRIPE_SECRET_KEY
# …and so on
```

## 4. Build and deploy

```bash
npm run deploy        # tsc + vite build, then wrangler deploy
```

Wrangler prints the URL (`https://fork-command-center.<subdomain>.workers.dev`). To use your own domain, add a route or custom domain in the Cloudflare dashboard (e.g. `command.forkalgorithm.com`).

## 5. Recommended: put Cloudflare Access in front

The app has its own sign-in, RBAC and rate limiting. For a founder-only tool, also add a **Cloudflare Zero Trust → Access** application on the hostname, restricted to your email. Exclude only `/api/webhooks/make` and `/api/worker/*` with a bypass policy, because Make.com and external workers can't complete an Access login. Both of those paths authenticate with their own secrets.

## 6. First sign-in checklist

1. Sign in with `OWNER_EMAIL` and `OWNER_PASSWORD`.
2. **Settings → Integrations:** click **Test connection** on each integration you configured. An integration only shows **Connected** after a successful live test. The Anthropic test must pass before any agent can execute in the Worker.
3. **Settings → Policies:** confirm the weekly CEO review day (default Friday), hour and time zone. Leave `Max single transaction` at 0 until you want financial approvals to be possible.
4. **Agents → Atlas → Model & prompt:** set the provider to *Anthropic* (if a key is set). Then:
   - on **Pause / replace**, enable the profile;
   - on **Command panel**, authorize *Drafting* (and *Reporting*).
5. Repeat for the other agents as you're ready. Each agent stays disabled and draft-only until you change it. The readiness checklist on each agent shows exactly what is still missing.
6. Optional: **Settings → Demonstration data** loads flagged sample records for a tour. Remove them before relying on the dashboard.

## 7. Cron schedule

`wrangler.toml` defines one cron trigger, `*/15 * * * *`. Each run:

- recovers tasks whose execution lease expired (recorded as a `lease_expired` attempt);
- runs up to 3 due tasks for Anthropic-provider agents that pass every readiness check, inside their operating schedule;
- generates the weekly CEO review once the configured day and hour arrive (Settings → Policies; default Friday 16:00 America/New_York), at most once per week;
- prunes expired sessions and rate-limit rows.

## 8. Connecting Make.com

**Inbound (run reports).** At the end of each scenario, and in an error-handler route, add an *HTTP → Make a request* module:

- URL: `https://<your-host>/api/webhooks/make`, method `POST`, body type raw JSON
- Body: `{"workflow":"Lead intake","execution_id":"{{executionId}}","status":"completed","started_at":"…","finished_at":"…","error":""}`. Use `status: "failed"` and the error message in the error route.
- Header: `Authorization: Bearer <MAKE_WEBHOOK_SECRET>`, **or** `X-Signature: {{sha256(body; "hex"; MAKE_WEBHOOK_SECRET)}}` for an HMAC signature.

Repeated deliveries with the same `execution_id` update one record instead of creating duplicates. Each failed run raises an alert assigned to Forge.

**Outbound (alerts and approved actions).** Create a scenario that starts with a *Custom webhook* and put its URL in `MAKE_OUTBOUND_WEBHOOK_URL`. Payloads carry `type`, which is one of:

- `ping`
- `alert`
- `task.dispatch`: the exact `action_type`, `destination`, `content`, `amount_cents` and `currency` from the approved release, plus `approval_id` and an `idempotency_key`. Make should treat a repeated key as already handled.

When `MAKE_WEBHOOK_SECRET` is set, verify the `X-Fork-Signature` header (HMAC-SHA256 of the raw body) in the scenario.

## 9. Running an agent outside Cloudflare

See `examples/external-worker.mjs`. Requirements:

- the owner turns on **Settings → Policies → Allow external workers**;
- the agent's provider is *External worker* and its profile is enabled.

The worker claims tasks, writes logs (which also extend its lease), and reports `complete` or `fail`. Through `/api/worker/tasks`, workers can only *propose* new tasks; approval rules still apply.

## Local verification before deploying

```bash
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run build
npm run worker:dev          # in one terminal
npm test                    # in another: 24 end-to-end tests
```

## Rollback

`npx wrangler rollback -c wrangler.toml` restores the previous Worker version. D1 migrations are forward-only, and the previous Worker version does not understand the 0003 schema, so restore from the export you took in step 2 if you need to go back.
