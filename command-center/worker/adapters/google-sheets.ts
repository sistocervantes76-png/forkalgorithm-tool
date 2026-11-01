import type { Env } from "../env";
import { parseJsonField } from "../lib";
import type { Adapter } from "./types";

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

export const googleSheetsAdapter: Adapter = {
  key: "google_sheets",
  name: "Google Sheets",
  category: "Business records",
  secrets: ["GOOGLE_SERVICE_ACCOUNT_JSON", "GOOGLE_SHEETS_ID"],
  description: "Reads business records from one spreadsheet via a service account. Writes are not implemented yet.",
  test: async (env) => {
    const token = await googleAccessToken(env);
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(env.GOOGLE_SHEETS_ID!)}?fields=properties.title`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Sheets responded ${res.status}`);
    const data = (await res.json()) as { properties?: { title?: string } };
    return `Spreadsheet "${data.properties?.title ?? "?"}" readable`;
  },
};
