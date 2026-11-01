// Common shape for every external integration. Each adapter lives in its own
// module, owns its secrets (read from Worker secrets only, never from D1 or the
// browser) and exposes an optional live test. Nothing reports "connected"
// without a successful live call or a verified inbound contact.
import type { Env } from "../env";
import type { IntegrationKey } from "../../shared/domain";

export interface Adapter {
  key: IntegrationKey;
  name: string;
  category: string;
  secrets: (keyof Env)[];
  description: string;
  /** Live check against the provider. Returns a human-readable success message or throws. */
  test?: (env: Env) => Promise<string>;
  /** For receive-only integrations: when the last verified inbound contact happened, if ever. */
  lastVerifiedContact?: (env: Env) => Promise<string | null>;
}
