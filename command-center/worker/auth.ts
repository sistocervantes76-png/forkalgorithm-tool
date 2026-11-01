import type { Env } from "./env";
import type { Role } from "../shared/domain";
import { HttpError, audit, clientIp, json, nowIso, rateLimit, randomToken, safeEqual, sha256Hex, toHex } from "./lib";
import { reqStr } from "./validate";

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
}

const SESSION_COOKIE = "fa_session";
const SESSION_DAYS = 7;
const ROLE_RANK: Record<Role, number> = { viewer: 0, operator: 1, admin: 2, owner: 3 };
const PBKDF2_ITERATIONS = 100_000;

export function hasRole(user: User, min: Role): boolean {
  return ROLE_RANK[user.role] >= ROLE_RANK[min];
}

export function requireRole(user: User, min: Role): void {
  if (!hasRole(user, min)) throw new HttpError(403, `This action requires the ${min} role`);
}

// ---------------------------------------------------------------- passwords

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toHex(salt.buffer)}$${hash}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iter, saltHex, hash] = stored.split("$");
  if (scheme !== "pbkdf2" || !iter || !saltHex || !hash) return false;
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
  return safeEqual(await pbkdf2(password, salt, Number(iter)), hash);
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return toHex(bits);
}

// ---------------------------------------------------------------- sessions

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("Cookie") ?? "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

function sessionCookie(token: string, maxAge: number, secure: boolean): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

export async function currentUser(req: Request, env: Env): Promise<User | null> {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.role FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > ? AND u.disabled = 0`,
  )
    .bind(await sha256Hex(token), nowIso())
    .first<User>();
  return row ?? null;
}

export async function login(req: Request, env: Env, body: Record<string, unknown>): Promise<Response> {
  const ip = clientIp(req);
  const email = reqStr(body, "email", { max: 254 }).toLowerCase();
  const password = reqStr(body, "password", { max: 256 });

  const ipOk = await rateLimit(env, `login-ip:${ip}`, 10, 900);
  const emailOk = await rateLimit(env, `login-email:${email}`, 10, 900);
  if (!ipOk || !emailOk) {
    await raiseSecurityAlert(env, `Repeated login attempts for ${email}`, `Login rate limit exceeded from ${ip}.`, `login-rl:${email}:${new Date().toISOString().slice(0, 13)}`);
    throw new HttpError(429, "Too many login attempts. Try again in 15 minutes.");
  }

  let user: (User & { password_hash: string | null; disabled: number }) | null = null;
  const ownerEmail = env.OWNER_EMAIL?.trim().toLowerCase();

  if (ownerEmail && env.OWNER_PASSWORD && email === ownerEmail) {
    if (safeEqual(password, env.OWNER_PASSWORD)) {
      const now = nowIso();
      await env.DB.prepare(
        `INSERT INTO users (id, email, name, role, created_at) VALUES (?, ?, ?, 'owner', ?)
         ON CONFLICT (email) DO UPDATE SET role = 'owner', disabled = 0, name = excluded.name`,
      )
        .bind(`usr-${crypto.randomUUID()}`, email, env.OWNER_NAME?.trim() || "Founder", now)
        .run();
      user = await env.DB.prepare("SELECT id, email, name, role, password_hash, disabled FROM users WHERE email = ?").bind(email).first();
    }
  } else {
    const row = await env.DB.prepare("SELECT id, email, name, role, password_hash, disabled FROM users WHERE email = ?")
      .bind(email)
      .first<User & { password_hash: string | null; disabled: number }>();
    if (row && !row.disabled && row.password_hash && (await verifyPassword(password, row.password_hash))) user = row;
  }

  if (!user) {
    await audit(env, "anonymous", "auth.login_failed", "user", null, { email }, ip);
    throw new HttpError(401, "Email or password is incorrect");
  }

  const token = randomToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
  await env.DB.prepare("INSERT INTO sessions (id, user_id, created_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(await sha256Hex(token), user.id, nowIso(), expires, ip, (req.headers.get("User-Agent") ?? "").slice(0, 200))
    .run();
  await env.DB.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").bind(nowIso(), user.id).run();
  await audit(env, `user:${user.id}`, "auth.login", "user", user.id, {}, ip);

  const secure = new URL(req.url).protocol === "https:";
  return json(
    { user: { id: user.id, email: user.email, name: user.name, role: user.role } },
    200,
    { "Set-Cookie": sessionCookie(token, SESSION_DAYS * 86400, secure) },
  );
}

export async function logout(req: Request, env: Env, user: User | null): Promise<Response> {
  const token = readCookie(req, SESSION_COOKIE);
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(await sha256Hex(token)).run();
  if (user) await audit(env, `user:${user.id}`, "auth.logout", "user", user.id, {}, clientIp(req));
  const secure = new URL(req.url).protocol === "https:";
  return json({ ok: true }, 200, { "Set-Cookie": sessionCookie("", 0, secure) });
}

export async function raiseSecurityAlert(env: Env, title: string, body: string, dedupeKey: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO alerts (id, severity, category, title, body, dedupe_key, created_at)
     VALUES (?, 'critical', 'security', ?, ?, ?, ?) ON CONFLICT (dedupe_key) DO NOTHING`,
  )
    .bind(`ALR-${crypto.randomUUID().slice(0, 8).toUpperCase()}`, title, body, dedupeKey, nowIso())
    .run();
}

/** Bearer token check for the external worker API (agents running outside this Worker). */
export async function requireWorkerToken(req: Request, env: Env): Promise<void> {
  const header = req.headers.get("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!env.WORKER_TOKEN || !token || !safeEqual(token, env.WORKER_TOKEN)) {
    throw new HttpError(401, "Invalid worker token");
  }
  const setting = await env.DB.prepare("SELECT value FROM settings WHERE key = 'access.allow_external_workers'").first<{ value: string }>();
  if (setting?.value !== "true") {
    throw new HttpError(403, "External workers are disabled. The owner must enable access.allow_external_workers.");
  }
}
