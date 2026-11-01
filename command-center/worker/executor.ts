// In-Worker draft executor. Runs a scheduled task for an agent whose provider
// is "anthropic" and returns a DRAFT. It has no tools that act on the outside
// world: it cannot send, publish, pay or change records. The only optional
// tool is Claude's server-side web search, and only when the agent's
// web_research capability is requested, granted and backed by a key.
import Anthropic from "@anthropic-ai/sdk";
import type { Env } from "./env";
import { HttpError, nowIso, parseJsonField } from "./lib";
import { claimTask, completeTask, effectiveCapabilities, failTask, getAgent, getTask, hasCapability, type AgentRow, type TaskRow } from "./tasks";
import { integrationStatus } from "./integrations";

const DEFAULT_MODEL = "claude-opus-5-5";
const FALLBACK_CAPABLE = new Set(["claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5-1"]);

const GUARDRAILS = `
Operating rules (set by the Command Center, not editable by the agent):
- You produce a DRAFT for founder review. You cannot send messages, publish, spend money, or change any system.
- Do not state that anything was sent, scheduled, purchased or completed outside this draft.
- If you lack information, list what is missing instead of inventing it. Never fabricate metrics, prices, contacts or quotes.
- When you use web research, cite the source URL for each factual claim.
- Do not collect personal data beyond published business contact channels.`;

export interface ReadinessCheck {
  key: "profile" | "backend" | "credentials" | "tools" | "autonomy";
  label: string;
  ok: boolean;
  detail: string;
}

/**
 * Whether an agent can actually execute work. Enabling a profile is only one of
 * five conditions; selecting a capability is not access. Approval of each gated
 * task is checked separately, at claim time, against the task's exact spec.
 */
export async function executionReadiness(env: Env, agent: AgentRow): Promise<{ ready: boolean; summary: string; checks: ReadinessCheck[] }> {
  const checks: ReadinessCheck[] = [];
  checks.push({
    key: "profile",
    label: "Profile enabled",
    ok: Boolean(agent.enabled && !agent.paused && !agent.archived),
    detail: agent.archived ? "Archived" : !agent.enabled ? "Profile disabled" : agent.paused ? "Paused" : "Enabled (this alone does not start anything)",
  });

  let backendOk = false;
  let backendDetail = "No backend worker configured (provider: none)";
  let credOk = false;
  let credDetail = "No provider credentials";
  if (agent.provider === "anthropic") {
    backendOk = true;
    backendDetail = "In-Worker draft executor";
    const st = await integrationStatus(env, "anthropic");
    credOk = st.status === "connected";
    credDetail = st.status === "connected" ? "Anthropic key verified by a live test" : st.status === "not_configured" ? "ANTHROPIC_API_KEY not configured" : st.status === "unverified" ? "Key set but not verified. Run Test connection in Settings." : `Last connection test failed: ${st.last_test?.message ?? "unknown"}`;
  } else if (agent.provider === "custom-worker") {
    const allowed = await env.DB.prepare("SELECT value FROM settings WHERE key = 'access.allow_external_workers'").first<{ value: string }>();
    const fresh = agent.last_heartbeat_at && Date.now() - new Date(agent.last_heartbeat_at).getTime() < 10 * 60_000;
    backendOk = allowed?.value === "true" && Boolean(fresh);
    backendDetail = allowed?.value !== "true" ? "External workers are disabled (owner setting)" : fresh ? "External worker online" : agent.last_heartbeat_at ? "External worker offline" : "No external worker has connected yet";
    credOk = Boolean(env.WORKER_TOKEN) && Boolean(agent.last_heartbeat_at);
    credDetail = !env.WORKER_TOKEN ? "WORKER_TOKEN not configured" : agent.last_heartbeat_at ? "Worker authenticated with the worker token" : "Worker token set; no authenticated contact yet";
  }
  checks.push({ key: "backend", label: "Backend worker configured", ok: backendOk, detail: backendDetail });
  checks.push({ key: "credentials", label: "Valid provider credentials", ok: credOk, detail: credDetail });

  const caps = await effectiveCapabilities(env, agent.id);
  const effective = caps.filter((c) => c.effective).map((c) => c.label);
  const drafting = caps.find((c) => c.key === "drafting");
  const toolsOk = agent.provider === "anthropic" ? Boolean(drafting?.effective) : effective.length > 0;
  checks.push({
    key: "tools",
    label: "Tools authorized",
    ok: toolsOk,
    detail: effective.length ? `Authorized and backed: ${effective.join(", ")}` : `None active. ${drafting?.blocked_reason ? `Drafting: ${drafting.blocked_reason}` : "Selecting a capability does not grant it."}`,
  });
  checks.push({ key: "autonomy", label: "Allowed to execute", ok: agent.autonomy !== "observer", detail: agent.autonomy === "observer" ? "Observer: reports only" : `Autonomy: ${agent.autonomy.replace("_", " ")}` });

  const ready = checks.every((c) => c.ok);
  const failing = checks.filter((c) => !c.ok).map((c) => c.label.toLowerCase());
  return { ready, summary: ready ? "Ready to execute approved tasks" : `Not running: missing ${failing.join(", ")}`, checks };
}

export async function canExecuteInWorker(env: Env, agent: AgentRow): Promise<string | null> {
  if (agent.provider !== "anthropic") return "Agent provider is not set to Anthropic";
  if (!env.ANTHROPIC_API_KEY) return "ANTHROPIC_API_KEY is not configured";
  const st = await integrationStatus(env, "anthropic");
  if (st.status !== "connected") return "Anthropic credentials are not verified. Run Test connection in Settings.";
  if (!agent.enabled) return "Agent profile is disabled";
  if (agent.paused) return "Agent is paused";
  if (agent.archived) return "Agent is archived";
  if (agent.autonomy === "observer") return "Observer agents cannot execute tasks";
  if (!(await hasCapability(env, agent.id, "drafting"))) return "Drafting capability is not authorized for this agent";
  return null;
}

export async function executeTask(env: Env, taskId: string, actor: string): Promise<TaskRow> {
  const task = await getTask(env, taskId);
  if (task.is_demo) throw new HttpError(409, "Demonstration tasks cannot be executed");
  if (!task.agent_id) throw new HttpError(409, "Task has no assigned agent");
  if (task.status !== "scheduled") throw new HttpError(409, `Only scheduled tasks can run (this one is ${task.status})`);
  const agent = await getAgent(env, task.agent_id);
  const blocked = await canExecuteInWorker(env, agent);
  if (blocked) throw new HttpError(409, blocked);

  const leaseSetting = await env.DB.prepare("SELECT value FROM settings WHERE key = 'tasks.running_lease_minutes'").first<{ value: string }>();
  const claimed = await claimTask(env, taskId, actor, Number(leaseSetting?.value ?? 30));
  if (!claimed) throw new HttpError(409, "Task was already claimed by another executor");

  try {
    const output = await runAgent(env, agent, claimed);
    const result = `AI DRAFT — generated by ${agent.name} (${output.model}) at ${nowIso()}. Not sent or published.\n\n${output.text}`;
    return await completeTask(env, taskId, result, `executor:${agent.id}`);
  } catch (err) {
    const { message, retryable } = describeError(err);
    return await failTask(env, taskId, message, `executor:${agent.id}`, retryable);
  }
}

function describeError(err: unknown): { message: string; retryable: boolean } {
  if (err instanceof Anthropic.RateLimitError) return { message: "Anthropic rate limit reached", retryable: true };
  if (err instanceof Anthropic.AuthenticationError) return { message: "Anthropic rejected the API key", retryable: false };
  if (err instanceof Anthropic.BadRequestError) return { message: `Anthropic rejected the request: ${err.message}`, retryable: false };
  if (err instanceof Anthropic.APIConnectionError) return { message: "Could not reach Anthropic", retryable: true };
  if (err instanceof Anthropic.APIError) return { message: `Anthropic error ${err.status}: ${err.message}`, retryable: (err.status ?? 500) >= 500 };
  if (err instanceof HttpError) return { message: err.message, retryable: false };
  return { message: err instanceof Error ? err.message : "Unknown executor error", retryable: false };
}

async function runAgent(env: Env, agent: AgentRow, task: TaskRow): Promise<{ text: string; model: string }> {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const model = agent.model || DEFAULT_MODEL;
  const useWebSearch = await hasCapability(env, agent.id, "web_research");
  const responsibilities = parseJsonField<string[]>(agent.responsibilities, []);
  const prefs = await env.DB.prepare("SELECT value FROM founder_preferences WHERE key = ?").bind(`planning.agent.${agent.id}`).first<{ value: string }>();

  const system = [
    agent.system_prompt,
    responsibilities.length ? `Your responsibilities:\n- ${responsibilities.join("\n- ")}` : "",
    prefs ? `Founder feedback on your past recommendations (planning preferences only):\n${prefs.value}` : "",
    GUARDRAILS,
  ]
    .filter(Boolean)
    .join("\n\n");

  const messages: Anthropic.Beta.BetaMessageParam[] = [
    {
      role: "user",
      content: `Task ${task.id} (${task.kind}, priority ${task.priority})\nTitle: ${task.title}\n\n${task.description || "(no further description)"}`,
    },
  ];

  const tools: Anthropic.Beta.BetaToolUnion[] = useWebSearch ? [{ type: "web_search_20260209", name: "web_search", max_uses: 5 }] : [];

  // Server-side tools can pause a long turn; resume a bounded number of times.
  for (let turn = 0; turn < 4; turn++) {
    const response = await client.beta.messages.create({
      model,
      max_tokens: 16000,
      system,
      messages,
      ...(tools.length ? { tools } : {}),
      output_config: { effort: "medium" },
      ...(FALLBACK_CAPABLE.has(model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    });

    if (response.stop_reason === "refusal") {
      throw new HttpError(422, `Model declined the task${response.stop_details?.category ? ` (${response.stop_details.category})` : ""}`);
    }
    if (response.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: response.content });
      continue;
    }
    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (!text) throw new HttpError(502, "Model returned no text");
    const suffix = response.stop_reason === "max_tokens" ? "\n\n[Draft truncated at the output limit]" : "";
    return { text: text + suffix, model: response.model };
  }
  throw new HttpError(504, "Model did not finish after several resumptions");
}

/** One-shot narrative for the weekly briefing. Returns null if Atlas can't use the AI provider. */
export async function briefingNarrative(env: Env, facts: unknown): Promise<string | null> {
  const atlas = await getAgent(env, "agt-atlas").catch(() => null);
  if (!atlas || (await canExecuteInWorker(env, atlas))) return null;
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const model = atlas.model || DEFAULT_MODEL;
  const response = await client.beta.messages.create({
    model,
    max_tokens: 4000,
    system: `${atlas.system_prompt}\n\n${GUARDRAILS}\nWrite a weekly CEO briefing from ONLY the JSON facts provided. Under 300 words. Sections: Headline, What moved, Needs your decision, Risks, Recommended focus. If a section has no data, say so.`,
    messages: [{ role: "user", content: JSON.stringify(facts) }],
    output_config: { effort: "low" },
    ...(FALLBACK_CAPABLE.has(model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
  });
  if (response.stop_reason === "refusal") return null;
  const text = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  return text || null;
}
