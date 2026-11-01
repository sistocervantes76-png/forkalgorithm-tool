// Integration registry. Each adapter lives in worker/adapters/. Status values:
//   not_configured  required secrets are missing
//   unverified      secrets are set but no live test / verified contact yet
//   connected       the last live test succeeded, or a verified inbound contact arrived
//   disconnected    the last live test failed
// Nothing here ever reports "connected" without a successful live call.
import type { Env } from "./env";
import type { IntegrationKey } from "../shared/domain";
import { HttpError, nowIso, parseJsonField } from "./lib";
import type { Adapter } from "./adapters/types";
import { anthropicAdapter, workerApiAdapter } from "./adapters/ai";
import { makeInboundAdapter, makeOutboundAdapter } from "./adapters/make";
import { stripeAdapter } from "./adapters/stripe";
import { ringCentralAdapter } from "./adapters/ringcentral";
import { googleSheetsAdapter } from "./adapters/google-sheets";

export { sendToMake } from "./adapters/make";
export { stripeFinancialSummary } from "./adapters/stripe";
export { readSheetRange } from "./adapters/google-sheets";

export type IntegrationStatus = "not_configured" | "unverified" | "connected" | "disconnected";

const internalAdapter: Adapter = {
  key: "internal",
  name: "Command Center records",
  category: "Core",
  secrets: [],
  description: "D1 database: tasks, approvals, logs, audit history. Always available.",
};

export const INTEGRATIONS: (Adapter & { testable: boolean })[] = [
  internalAdapter,
  anthropicAdapter,
  workerApiAdapter,
  makeInboundAdapter,
  makeOutboundAdapter,
  stripeAdapter,
  ringCentralAdapter,
  googleSheetsAdapter,
].map((a) => ({ ...a, testable: Boolean(a.test) }));

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

async function statusFor(env: Env, def: (typeof INTEGRATIONS)[number], last: TestRecord | null) {
  const present = secretsPresent(env, def.key);
  let status: IntegrationStatus;
  let verified_at: string | null = null;
  if (def.key === "internal") status = "connected";
  else if (!present) status = "not_configured";
  else if (def.test) status = !last ? "unverified" : last.ok ? "connected" : "disconnected";
  else {
    verified_at = (await def.lastVerifiedContact?.(env)) ?? null;
    status = verified_at ? "connected" : "unverified";
  }
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
    verified_contact_at: verified_at,
  };
}

async function lastTests(env: Env): Promise<Map<string, TestRecord | null>> {
  const rows = await env.DB.prepare("SELECT key, value FROM settings WHERE key LIKE 'integration.%.last_test'").all<{ key: string; value: string }>();
  return new Map(rows.results.map((r) => [r.key.split(".")[1], parseJsonField<TestRecord | null>(r.value, null)]));
}

export async function integrationStatuses(env: Env) {
  const tests = await lastTests(env);
  return Promise.all(INTEGRATIONS.map((def) => statusFor(env, def, tests.get(def.key) ?? null)));
}

export async function integrationStatus(env: Env, key: IntegrationKey) {
  const def = INTEGRATIONS.find((d) => d.key === key);
  if (!def) throw new HttpError(404, "Unknown integration");
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = ?").bind(`integration.${key}.last_test`).first<{ value: string }>();
  return statusFor(env, def, parseJsonField<TestRecord | null>(row?.value, null));
}

/** Whether an integration's credentials are present, for capability gating. */
export async function integrationUsable(env: Env, key: IntegrationKey): Promise<boolean> {
  if (key === "internal") return true;
  return secretsPresent(env, key);
}

export async function testIntegration(env: Env, key: IntegrationKey): Promise<TestRecord> {
  const def = INTEGRATIONS.find((d) => d.key === key);
  if (!def?.test) throw new HttpError(409, "This integration has no live test");
  if (!secretsPresent(env, key)) throw new HttpError(409, "Not configured: required secrets are not set");
  let record: TestRecord;
  try {
    record = { ok: true, at: nowIso(), message: await def.test(env) };
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
