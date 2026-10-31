# Deploying the Command Center to Cloudflare

All commands run from `command-center/`. You need a Cloudflare account and Node 20+.

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

Copy the printed `database_id` into `wrangler.toml` (the current value points at the production database already created for this project), then apply the schema and seed:

```bash
npm run db:migrate:remote
```

The seed contains configuration only: departments, the nine agent profiles (all **disabled**, no capabilities authorized) and default settings. It contains no tasks or results.

## 3. Set secrets

Secrets live only in Cloudflare. They never reach the browser or the database.

**Required**

```bash
npx wrangler secret put OWNER_PASSWORD     # long, unique passphrase
npx wrangler secret put WORKER_TOKEN       # e.g. `openssl rand -base64 32`
```

Set `OWNER_EMAIL` as a secret (`npx wrangler secret put OWNER_EMAIL`) or as a variable in the dashboard; `keep_vars = true` in `wrangler.toml` keeps dashboard variables across deploys. Signing in with that email and `OWNER_PASSWORD` creates or refreshes the single **owner** account. Add other users (admin, operator, viewer) in **Settings → Users & roles**.

**Optional — add each only when you have the access. Until then the integration shows as Disconnected.**

| Secret(s) | Enables |
|---|---|
| `ANTHROPIC_API_KEY` | In-Worker draft executor and the AI narrative in briefings. Set a spend cap in the Anthropic Console too. |
| `MAKE_WEBHOOK_SECRET` | Inbound Make.com run reports at `/api/webhooks/make` |
| `MAKE_OUTBOUND_WEBHOOK_URL` | Immediate alert notifications and "Dispatch to Make.com" for approved tasks (signed with `MAKE_WEBHOOK_SECRET` when set) |
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
2. **Settings → Integrations:** click **Test connection** on each integration you configured. An integration only shows **Connected** after a successful live test.
3. **Agents → Atlas → Model & prompt:** set the provider to *Anthropic* (if a key is set). Then:
   - on **Pause / replace**, enable the profile;
   - on **Command panel**, authorize *Drafting* (and *Reporting*).
4. Repeat for the other agents as you're ready. Each agent stays disabled and draft-only until you change it.
5. Optional: **Settings → Demonstration data** loads flagged sample records for a tour. Remove them before relying on the dashboard.

## 7. Cron schedule

`wrangler.toml` defines two cron triggers (times in UTC):

- `*/15 * * * *` — recovers tasks whose execution lease expired, runs up to 3 due tasks for Anthropic-provider agents inside their operating schedule, and prunes expired sessions and rate-limit rows.
- `0 21 * * 5` — the Friday CEO briefing (21:00 UTC = 5 pm US Eastern during daylight time). Edit this line to move it.

## 8. Connecting Make.com

**Inbound (run reports).** At the end of each scenario, and in an error-handler route, add an *HTTP → Make a request* module:

- URL: `https://<your-host>/api/webhooks/make`, method `POST`, body type raw JSON
- Body: `{"workflow":"Lead intake","execution_id":"{{executionId}}","status":"completed","started_at":"…","finished_at":"…","error":""}`. Use `status: "failed"` and the error message in the error route.
- Header: `Authorization: Bearer <MAKE_WEBHOOK_SECRET>`, **or** `X-Signature: {{sha256(body; "hex"; MAKE_WEBHOOK_SECRET)}}` for an HMAC signature.

Repeated deliveries with the same `execution_id` update one record instead of creating duplicates. Each failed run raises an alert assigned to Forge.

**Outbound (alerts and approved actions).** Create a scenario that starts with a *Custom webhook* and put its URL in `MAKE_OUTBOUND_WEBHOOK_URL`. Payloads carry `type`, which is one of:

- `ping`
- `alert`
- `task.dispatch` (includes an `idempotency_key`)

When `MAKE_WEBHOOK_SECRET` is set, verify the `X-Fork-Signature` header (HMAC-SHA256 of the raw body) in the scenario.

## 9. Running an agent outside Cloudflare

See `examples/external-worker.mjs`. Requirements:

- the owner turns on **Settings → Policies → Allow external workers**;
- the agent's provider is *External worker* and its profile is enabled.

The worker claims tasks, writes logs (which also extend its lease), and reports `complete` or `fail`. Through `/api/worker/tasks`, workers can only *propose* new tasks; approval rules still apply.

## Rollback

`npx wrangler rollback` restores the previous Worker version. D1 migrations are forward-only. Take a backup first with `npx wrangler d1 export fork-command-center --remote --output backup.sql`.
