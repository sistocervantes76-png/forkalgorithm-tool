// Integration registry and adapters. Each adapter is independent and reports
// one of: disconnected (secrets missing) | configured (secrets present, never
// tested) | connected (last live test succeeded) | error (last test failed).
// Nothing here ever reports "connected" without a successful live call.
import type { Env } from "./env";
import type { IntegrationKey } from "../shared/domain";
import { HttpError, hmacSha256Hex, nowIso, parseJsonField } from "./lib";

export type IntegrationStatus = "disconnected" | "configured" | "connected" | "error";

interface Definition {
  key: IntegrationKey;
  name: string;
  category: string;
  secrets: (keyof Env)[];
  description: string;
  testable: boolean;
}

export const INTEGRATIONS: Definition[] = [
  { key: "internal", name: "Command Center records", category: "Core", secrets: [], description: "D1 database: tasks, approvals, logs. Always available.", testable: false },
  { key: "anthropic", name: "Anthropic (Claude)", category: "AI provider", secrets: ["ANTHROPIC_API_KEY"], description: "In-Worker draft executor and optional briefing narrative. Supports web search.", testable: true },
  { key: "worker_api", name: "External worker API", category: "Execution", secrets: ["WORKER_TOKEN"], description: "Lets agent processes you host elsewhere claim tasks and report results.", testable: false },
  { key: "make_inbound", name: "Make.com → Command Center", category: "Automation", secrets: ["MAKE_WEBHOOK_SECRET"], description: "Receives scenario run reports at /api/webhooks/make.", testable: false },
  { key: "make_outbound", name: "Command Center → Make.com", category: "Automation", secrets: ["MAKE_OUTBOUND_WEBHOOK_URL"], description: "Sends approved actions and immediate alerts to a Make.com scenario.", testable: true },
  { key: "stripe", name: "Stripe", category: "Payments", secrets: ["STRIPE_SECRET_KEY"], description: "Read-only balance and charge summaries for the financial overview.", testable: true },
  { key: "ringcentral", name: "RingCentral", category: "Communication", secrets: ["RINGCENTRAL_CLIENT_ID", "RINGCENTRAL_CLIENT_SECRET", "RINGCENTRAL_JWT"], description: "Credential check only. Calling and SMS are not implemented yet.", testable: true },
  { key: "google_sheets", name: "Google Sheets", category: "Business records", secrets: ["GOOGLE_SERVICE_ACCOUNT_JSON", "GOOGLE_SHEETS_ID"], description: "Reads business records from one spreadsheet via a service account.", testable: true },
];

interface TestRecord {
  ok: boolean;
  at: string;
  message: string;
}

export function secretsPresent(env: Env, key: IntegrationKey): boolean {
  const def = INTEGRATIONS.find((d) => d.key === key);
  if (!def) return false;
  return def.secrets.every((s) => typeof env[s] === "string" && (env[s] as string).length > 0);
}

export async function integrationStatuses(env: Env) {
  const rows = await env.DB.prepare("SELECT key, value FROM settings WHERE key LIKE 'integration.%.last_test'").all<{ key: string; value: string }>();
  const tests = new Map(rows.results.map((r) => [r.key.split(".")[1], parseJsonField<TestRecord | null>(r.value, null)]));
  return INTEGRATIONS.map((def) => {
    const present = secretsPresent(env, def.key);
    const last = tests.get(def.key) ?? null;
    let status: IntegrationStatus;
    if (!present) status = "disconnected";
    else if (!def.testable) status = def.key === "internal" ? "connected" : "configured";
    else if (!last) status = "configured";
    else status = last.ok ? "connected" : "error";
    return {
      key: def.key,
      name: def.name,
      category: def.category,
      description: def.description,
      required_secrets: def.secrets,
      secrets_present: present,
      testable: def.testable,
      status,
      last_test: last,
    };
  });
}

/** Whether an integration can be relied on for an agent capability right now. */
export async function integrationUsable(env: Env, key: IntegrationKey): Promise<boolean> {
  if (key === "internal") return true;
  return secretsPresent(env, key);
}

export async function testIntegration(env: Env, key: IntegrationKey): Promise<TestRecord> {
  if (!secretsPresent(env, key)) throw new HttpError(409, "Integration is disconnected: required secrets are not set");
  let record: TestRecord;
  try {
    const message = await runTest(env, key);
    record = { ok: true, at: nowIso(), message };
  } catch (err) {
    record = { ok: false, at: nowIso(), message: err instanceof Error ? err.message.slice(0, 300) : "Unknown error" };
  }
  await env.DB.prepare(
    `INSERT INTO settings (key, value, protected, updated_by, updated_at) VALUES (?, ?, 0, 'system', ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  )
    .bind(`integration.${key}.last_test`, JSON.stringify(record), record.at)
    .run();
  return record;
}

async function runTest(env: Env, key: IntegrationKey): Promise<string> {
  switch (key) {
    case "anthropic": {
      const res = await fetch("https://api.anthropic.com/v1/models?limit=1", {
        headers: { "x-api-key": env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" },
      });
      if (!res.ok) throw new Error(`Anthropic responded ${res.status}`);
      return "API key accepted";
    }
    case "stripe": {
      const res = await stripeGet(env, "/v1/balance");
      return `Stripe account reachable (${res.livemode ? "live" : "test"} mode)`;
    }
    case "make_outbound": {
      await sendToMake(env, { type: "ping", sent_at: nowIso() });
      return "Webhook accepted a ping";
    }
    case "ringcentral": {
      await ringCentralToken(env);
      return "JWT credentials exchanged for an access token";
    }
    case "google_sheets": {
      const token = await googleAccessToken(env);
      const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(env.GOOGLE_SHEETS_ID!)}?fields=properties.title`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`Sheets responded ${res.status}`);
      const data = (await res.json()) as { properties?: { title?: string } };
      return `Spreadsheet "${data.properties?.title ?? "?"}" readable`;
    }
    default:
      throw new Error("This integration has no live test");
  }
}

// ---------------------------------------------------------------- Stripe (read-only)

async function stripeGet(env: Env, path: string): Promise<any> {
  const res = await fetch(`https://api.stripe.com${path}`, { headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } });
  if (!res.ok) throw new Error(`Stripe responded ${res.status}`);
  return res.json();
}

export async function stripeFinancialSummary(env: Env) {
  const since = Math.floor(Date.now() / 1000) - 30 * 86400;
  const [balance, charges] = await Promise.all([
    stripeGet(env, "/v1/balance"),
    stripeGet(env, `/v1/charges?limit=100&created[gte]=${since}`),
  ]);
  const sum = (arr: { amount: number; currency: string }[]) =>
    arr.reduce<Record<string, number>>((acc, b) => ((acc[b.currency] = (acc[b.currency] ?? 0) + b.amount), acc), {});
  const succeeded = (charges.data as any[]).filter((c) => c.status === "succeeded" && !c.refunded);
  const failed = (charges.data as any[]).filter((c) => c.status === "failed");
  const byDay: Record<string, number> = {};
  for (const c of succeeded) {
    const day = new Date(c.created * 1000).toISOString().slice(0, 10);
    byDay[day] = (byDay[day] ?? 0) + c.amount;
  }
  return {
    source: "stripe",
    livemode: balance.livemode as boolean,
    fetched_at: nowIso(),
    available: sum(balance.available),
    pending: sum(balance.pending),
    last_30_days: {
      gross_cents_by_currency: sum(succeeded),
      succeeded_count: succeeded.length,
      failed_count: failed.length,
      truncated: Boolean(charges.has_more),
      by_day: byDay,
    },
  };
}

// ---------------------------------------------------------------- Make.com outbound

/** POSTs a signed JSON payload to the configured Make.com custom webhook. */
export async function sendToMake(env: Env, payload: Record<string, unknown>): Promise<void> {
  if (!env.MAKE_OUTBOUND_WEBHOOK_URL) throw new HttpError(409, "Make.com outbound webhook is not configured");
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (env.MAKE_WEBHOOK_SECRET) headers["X-Fork-Signature"] = await hmacSha256Hex(env.MAKE_WEBHOOK_SECRET, body);
  const res = await fetch(env.MAKE_OUTBOUND_WEBHOOK_URL, { method: "POST", headers, body });
  if (!res.ok) throw new Error(`Make.com responded ${res.status}`);
}

// ---------------------------------------------------------------- RingCentral

async function ringCentralToken(env: Env): Promise<string> {
  const server = env.RINGCENTRAL_SERVER_URL || "https://platform.ringcentral.com";
  const res = await fetch(`${server}/restapi/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${env.RINGCENTRAL_CLIENT_ID}:${env.RINGCENTRAL_CLIENT_SECRET}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: env.RINGCENTRAL_JWT! }),
  });
  if (!res.ok) throw new Error(`RingCentral responded ${res.status}`);
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

// ---------------------------------------------------------------- Google (service account)

function b64url(input: string | ArrayBuffer): string {
  const s = typeof input === "string" ? input : String.fromCharCode(...new Uint8Array(input));
  return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function googleAccessToken(env: Env): Promise<string> {
  const sa = parseJsonField<{ client_email?: string; private_key?: string } | null>(env.GOOGLE_SERVICE_ACCOUNT_JSON, null);
  if (!sa?.client_email || !sa.private_key) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not a valid service account key");
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/spreadsheets",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${claims}`));
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${header}.${claims}.${b64url(sig)}` }),
  });
  if (!res.ok) throw new Error(`Google token endpoint responded ${res.status}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

export async function readSheetRange(env: Env, range: string): Promise<string[][]> {
  const token = await googleAccessToken(env);
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(env.GOOGLE_SHEETS_ID!)}/values/${encodeURIComponent(range)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`Sheets responded ${res.status}`);
  return (((await res.json()) as { values?: string[][] }).values ?? []) as string[][];
}
