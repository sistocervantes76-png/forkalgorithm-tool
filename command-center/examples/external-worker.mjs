// Reference external worker: runs ONE agent outside Cloudflare and talks to the
// Command Center through the worker API. Replace `doWork` with your agent logic.
//
//   COMMAND_CENTER_URL=https://<your-worker>.workers.dev \
//   WORKER_TOKEN=... AGENT_ID=agt-forge node examples/external-worker.mjs
//
// Prerequisites (set by the owner in the UI):
//   - Settings → Policies: "Allow external workers" = On
//   - Agent → Model & prompt: provider = "External worker"; Pause/replace: profile enabled
const BASE = process.env.COMMAND_CENTER_URL;
const TOKEN = process.env.WORKER_TOKEN;
const AGENT_ID = process.env.AGENT_ID;
if (!BASE || !TOKEN || !AGENT_ID) throw new Error("Set COMMAND_CENTER_URL, WORKER_TOKEN and AGENT_ID");

async function call(path, body = {}) {
  const res = await fetch(`${BASE}/api/worker/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ agent_id: AGENT_ID, ...body }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${path}: ${res.status} ${data.error}`);
  return data;
}

async function doWork(task, log) {
  await log(`Working on: ${task.title}`);
  // ... your agent logic here. Return a string result, or throw to fail.
  return `Result for ${task.id}`;
}

async function loop() {
  for (;;) {
    try {
      const { task, reason } = await call("claim", { lease_minutes: 30 });
      if (!task) {
        if (reason) console.log("idle:", reason);
        await new Promise((r) => setTimeout(r, 60_000));
        continue;
      }
      const log = (message, level = "info") => call(`tasks/${task.id}/log`, { message, level });
      try {
        const result = await doWork(task, log);
        await call(`tasks/${task.id}/complete`, { result });
      } catch (err) {
        await call(`tasks/${task.id}/fail`, { error: String(err?.message ?? err), retryable: true });
      }
    } catch (err) {
      console.error(err);
      await new Promise((r) => setTimeout(r, 60_000));
    }
  }
}
loop();
