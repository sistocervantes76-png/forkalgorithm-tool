export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_ENV?: string;

  // Auth
  OWNER_EMAIL?: string;
  OWNER_NAME?: string; // display name for the founder account, e.g. "Sisto Cervantes"
  OWNER_PASSWORD?: string;
  WORKER_TOKEN?: string;
  WRITE_RATE_LIMIT_PER_MINUTE?: string; // optional; default 120 writes per user per minute

  // Integrations — each is optional; missing secrets mean "not configured".
  ANTHROPIC_API_KEY?: string;
  MAKE_WEBHOOK_SECRET?: string;
  MAKE_OUTBOUND_WEBHOOK_URL?: string;
  STRIPE_SECRET_KEY?: string;
  RINGCENTRAL_CLIENT_ID?: string;
  RINGCENTRAL_CLIENT_SECRET?: string;
  RINGCENTRAL_JWT?: string;
  RINGCENTRAL_SERVER_URL?: string;
  GOOGLE_SERVICE_ACCOUNT_JSON?: string;
  GOOGLE_SHEETS_ID?: string;
}
