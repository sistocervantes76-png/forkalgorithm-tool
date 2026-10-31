// Minimal input validation. Each helper throws HttpError(400) with a field-level message.
import { HttpError } from "./lib";

type Body = Record<string, unknown>;

function fail(field: string, msg: string): never {
  throw new HttpError(400, `Invalid ${field}: ${msg}`, { field });
}

export function str(body: Body, field: string, opts: { max?: number; min?: number; optional?: boolean; trim?: boolean } = {}): string | undefined {
  const v = body[field];
  if (v === undefined || v === null || v === "") {
    if (opts.optional) return undefined;
    fail(field, "is required");
  }
  if (typeof v !== "string") fail(field, "must be a string");
  const s = opts.trim === false ? v : v.trim();
  if (opts.min !== undefined && s.length < opts.min) fail(field, `must be at least ${opts.min} characters`);
  if (s.length > (opts.max ?? 2000)) fail(field, `must be at most ${opts.max ?? 2000} characters`);
  return s;
}

export function reqStr(body: Body, field: string, opts: { max?: number; min?: number } = {}): string {
  return str(body, field, opts) as string;
}

export function oneOf<T extends string>(body: Body, field: string, allowed: readonly T[], optional = false): T | undefined {
  const v = body[field];
  if (v === undefined || v === null) {
    if (optional) return undefined;
    fail(field, "is required");
  }
  if (typeof v !== "string" || !(allowed as readonly string[]).includes(v)) fail(field, `must be one of ${allowed.join(", ")}`);
  return v as T;
}

export function int(body: Body, field: string, opts: { min?: number; max?: number; optional?: boolean } = {}): number | undefined {
  const v = body[field];
  if (v === undefined || v === null || v === "") {
    if (opts.optional) return undefined;
    fail(field, "is required");
  }
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isInteger(n)) fail(field, "must be an integer");
  if (opts.min !== undefined && n < opts.min) fail(field, `must be ≥ ${opts.min}`);
  if (opts.max !== undefined && n > opts.max) fail(field, `must be ≤ ${opts.max}`);
  return n;
}

export function bool(body: Body, field: string, optional = true): boolean | undefined {
  const v = body[field];
  if (v === undefined || v === null) {
    if (optional) return undefined;
    fail(field, "is required");
  }
  if (typeof v !== "boolean") fail(field, "must be true or false");
  return v;
}

export function strArray(body: Body, field: string, opts: { maxItems?: number; maxLen?: number; optional?: boolean } = {}): string[] | undefined {
  const v = body[field];
  if (v === undefined || v === null) {
    if (opts.optional) return undefined;
    fail(field, "is required");
  }
  if (!Array.isArray(v)) fail(field, "must be an array");
  if (v.length > (opts.maxItems ?? 50)) fail(field, `must have at most ${opts.maxItems ?? 50} items`);
  return v.map((item, i) => {
    if (typeof item !== "string") fail(`${field}[${i}]`, "must be a string");
    const s = item.trim();
    if (s.length > (opts.maxLen ?? 500)) fail(`${field}[${i}]`, "is too long");
    return s;
  });
}

export function isoDate(body: Body, field: string, optional = true): string | undefined {
  const v = str(body, field, { optional, max: 40 });
  if (v === undefined) return undefined;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) fail(field, "must be an ISO date/time");
  return d.toISOString();
}

export function url(body: Body, field: string, optional = true): string | undefined {
  const v = str(body, field, { optional, max: 2048 });
  if (v === undefined) return undefined;
  try {
    const u = new URL(v);
    if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error();
    return u.toString();
  } catch {
    fail(field, "must be an http(s) URL");
  }
}
