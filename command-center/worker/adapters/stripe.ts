import type { Env } from "../env";
import { nowIso } from "../lib";
import type { Adapter } from "./types";

// ---------------------------------------------------------------- Stripe (read-only)

export async function stripeGet(env: Env, path: string): Promise<any> {
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


export const stripeAdapter: Adapter = {
  key: "stripe",
  name: "Stripe",
  category: "Payments",
  secrets: ["STRIPE_SECRET_KEY"],
  description: "Read-only balance and charge summaries. Cannot move money.",
  test: async (env) => {
    const res = await stripeGet(env, "/v1/balance");
    return `Stripe account reachable (${res.livemode ? "live" : "test"} mode)`;
  },
};
