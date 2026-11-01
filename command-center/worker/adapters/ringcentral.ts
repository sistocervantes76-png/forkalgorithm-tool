import type { Env } from "../env";
import type { Adapter } from "./types";

// ---------------------------------------------------------------- RingCentral

export async function ringCentralToken(env: Env): Promise<string> {
  const server = env.RINGCENTRAL_SERVER_URL || "https://platform.ringcentral.com";
  const res = await fetch(`${server}/restapi/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${env.RINGCENTRAL_CLIENT_ID}:${env.RINGCENTRAL_CLIENT_SECRET}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: env.RINGCENTRAL_JWT! }),
  });
  if (!res.ok) throw new Error(`RingCentral responded ${res.status}`);
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}


export const ringCentralAdapter: Adapter = {
  key: "ringcentral",
  name: "RingCentral",
  category: "Communication",
  secrets: ["RINGCENTRAL_CLIENT_ID", "RINGCENTRAL_CLIENT_SECRET", "RINGCENTRAL_JWT"],
  description: "Credential check only. Missed-call reading, calling and SMS are not implemented yet.",
  test: async (env) => {
    await ringCentralToken(env);
    return "JWT credentials exchanged for an access token";
  },
};
