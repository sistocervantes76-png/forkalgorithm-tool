// Fork Algorithm — Agent Command Center Worker.
// Serves the React app from static assets and the JSON API under /api.
import type { Env } from "./env";
import { currentUser, login, logout } from "./auth";
import { HttpError, clientIp, json, rateLimit, readJson } from "./lib";
import { routes, type Ctx } from "./routes";
import { handleExternal } from "./external";
import { runScheduled } from "./briefing";

const compiled = routes.map(([method, path, handler]) => {
  const keys: string[] = [];
  const re = new RegExp(
    "^" +
      path.replace(/:([a-zA-Z_]+)/g, (_, k) => {
        keys.push(k);
        return "([^/]+)";
      }) +
      "$",
  );
  return { method, re, keys, handler };
});

const SECURITY_HEADERS = {
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

async function handleApi(req: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname;
  const method = req.method;

  const external = await handleExternal(req, env, path);
  if (external) return external;

  const mutating = method !== "GET" && method !== "HEAD";
  // CSRF defence in depth: SameSite=Strict cookies plus a custom header that
  // cross-site forms cannot set.
  if (mutating && req.headers.get("X-Requested-With") !== "fork-command-center") {
    throw new HttpError(403, "Missing X-Requested-With header");
  }

  if (path === "/api/auth/login" && method === "POST") return login(req, env, await readJson(req));
  if (path === "/api/health") return json({ ok: true });

  const user = await currentUser(req, env);
  if (path === "/api/auth/logout" && method === "POST") return logout(req, env, user);
  if (!user) throw new HttpError(401, "Sign in required");

  if (mutating && !(await rateLimit(env, `write:${user.id}`, Number(env.WRITE_RATE_LIMIT_PER_MINUTE) || 120, 60))) throw new HttpError(429, "Too many changes; slow down");

  for (const r of compiled) {
    if (r.method !== method) continue;
    const m = path.match(r.re);
    if (!m) continue;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    const body = mutating ? await readJson(req) : {};
    const ctx: Ctx = { req, env, user, params, url, body, ip: clientIp(req) };
    return r.handler(ctx);
  }
  throw new HttpError(404, "Not found");
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/")) {
      const res = await env.ASSETS.fetch(req);
      const out = new Response(res.body, res);
      for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
      return out;
    }
    try {
      const res = await handleApi(req, env, url);
      for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.headers.set(k, v);
      return res;
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message, details: err.details ?? null }, err.status);
      console.error(err);
      return json({ error: "Internal error" }, 500);
    }
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runScheduled(env, controller.cron));
  },
} satisfies ExportedHandler<Env>;
