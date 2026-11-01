// AI provider adapters. The in-Worker executor asks this registry for a
// provider; adding another vendor means adding one entry here plus its secret.
// Only Anthropic is implemented. Other providers can run today as external
// workers through the worker API.
import type { Env } from "../env";
import type { Adapter } from "./types";

export const anthropicAdapter: Adapter = {
  key: "anthropic",
  name: "Anthropic (Claude)",
  category: "AI provider",
  secrets: ["ANTHROPIC_API_KEY"],
  description: "In-Worker draft executor and optional review narrative. Drafts only; it cannot send, publish or pay.",
  test: async (env) => {
    const res = await fetch("https://api.anthropic.com/v1/models?limit=1", {
      headers: { "x-api-key": env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" },
    });
    if (!res.ok) throw new Error(`Anthropic responded ${res.status}`);
    return "API key accepted";
  },
};

export interface AiProviderInfo {
  id: string;
  label: string;
  implemented: boolean;
  integration: string | null;
}

export const AI_PROVIDERS: AiProviderInfo[] = [
  { id: "none", label: "Not configured", implemented: true, integration: null },
  { id: "anthropic", label: "Anthropic (in-Worker draft executor)", implemented: true, integration: "anthropic" },
  { id: "custom-worker", label: "External worker (any provider, polls the worker API)", implemented: true, integration: "worker_api" },
];

export function aiProvider(id: string): AiProviderInfo | undefined {
  return AI_PROVIDERS.find((p) => p.id === id);
}

export const workerApiAdapter: Adapter = {
  key: "worker_api",
  name: "External worker API",
  category: "Execution",
  secrets: ["WORKER_TOKEN"],
  description: "Agent processes you host elsewhere claim tasks and report results. Connected while a worker has checked in within 10 minutes.",
  lastVerifiedContact: async (env: Env) => {
    const row = await env.DB.prepare("SELECT MAX(last_heartbeat_at) AS at FROM agents").first<{ at: string | null }>();
    if (!row?.at || Date.now() - new Date(row.at).getTime() > 10 * 60_000) return null;
    return row.at;
  },
};
