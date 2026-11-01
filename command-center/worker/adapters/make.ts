import type { Env } from "../env";
import { HttpError, hmacSha256Hex, nowIso } from "../lib";
import type { Adapter } from "./types";

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


export const makeOutboundAdapter: Adapter = {
  key: "make_outbound",
  name: "Command Center → Make.com",
  category: "Automation",
  secrets: ["MAKE_OUTBOUND_WEBHOOK_URL"],
  description: "Sends release-approved actions and immediate alerts to a Make.com scenario.",
  test: async (env) => {
    await sendToMake(env, { type: "ping", sent_at: nowIso() });
    return "Webhook accepted a ping";
  },
};

export const makeInboundAdapter: Adapter = {
  key: "make_inbound",
  name: "Make.com → Command Center",
  category: "Automation",
  secrets: ["MAKE_WEBHOOK_SECRET"],
  description: "Receives signed scenario run reports at /api/webhooks/make. Connected after the first verified report.",
  lastVerifiedContact: async (env) =>
    (await env.DB.prepare("SELECT MAX(created_at) AS at FROM workflow_runs WHERE source = 'make' AND is_demo = 0").first<{ at: string | null }>())?.at ?? null,
};
