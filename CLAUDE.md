# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Forkalgorithm is a single-page "chef tool" landing page: a static HTML page (`index.html`) that lets a visitor either (a) generate a recipe from a list of ingredients, or (b) get pro chef tips on a recipe they already have. The page calls Claude via a small Cloudflare Worker proxy (`worker.js`) that holds the Anthropic API key server-side. There is no build step, framework, or bundler — this is plain HTML/CSS/JS plus one serverless function.

## Architecture

- `index.html` — the entire frontend: inline `<style>`, markup for four "screens" (`s-input`, `s-result`, `s-email`, `s-thanks`), and inline `<script>` driving all interactivity. Screens are shown/hidden via the `show(id)` helper rather than routed pages.
  - `generate()` builds a prompt (recipe-from-ingredients or tips-on-a-recipe) and POSTs `{ messages: [...] }` to `WORKER_URL`.
  - The prompt instructs Claude to respond with **only** a specific JSON shape (`name`, `time`, `servings`, `ingredients`, `steps`, `tips`); `renderResult()` parses that JSON (stripping any ` ```json ` fences) and renders it into `.recipe-card`. If Claude's response doesn't match that shape, parsing fails and the generic error message ("Something went wrong…") is shown — there's no schema validation beyond the `try/catch` around `JSON.parse`.
  - After a result, the user is shown a single-question "bottleneck" survey (`pickBQ`), then an email capture screen (`s-email`), then a thanks screen with sharing buttons.
  - The email capture (`subscribe()`) does **not** currently call anything — it fakes a delay and moves on. There's a commented-out placeholder for a Mailchimp proxy call. Separately, a real Kit (ConvertKit) form is embedded at the bottom of the page (`data-sv-form="9623651"`) — this is a second, independent subscribe mechanism unrelated to the JS `subscribe()` flow. Don't assume these two email paths are connected.
  - `WORKER_URL` (top of the `<script>` block) is hardcoded to a specific `*.workers.dev` URL. If the Worker is redeployed under a different name/route, update this constant.

- `worker.js` — a Cloudflare Worker that is the *only* piece of backend code. It:
  - Handles CORS (`ALLOWED_ORIGIN = "*"` — intended to be tightened to the real domain once deployed, per the comment in the file).
  - Accepts POST only, validates the body has a non-empty `messages` array.
  - Forwards the request to `https://api.anthropic.com/v1/messages` using `env.ANTHROPIC_API_KEY` (set as a Worker secret, never committed) and a hardcoded model (`claude-sonnet-5`) and `max_tokens: 1500`.
  - Passes the Anthropic response straight through (status + body) to the caller.

- `wrangler.toml` — Worker config: `name = "forkalgorithm-tool"`, entry `main = "worker.js"`. No `[vars]`/bindings are declared here, so `ANTHROPIC_API_KEY` must be set via `wrangler secret put ANTHROPIC_API_KEY` (or the Cloudflare dashboard), not in this file.

- `package.json` — only exists to hold the `wrangler` devDependency and the `deploy` script; there is no app dependency tree, no test runner, no linter configured.

## Commands

```bash
npm install          # installs wrangler (the only dependency)
npm run deploy       # wrangler deploy — publishes worker.js per wrangler.toml
npx wrangler dev      # run the Worker locally for testing
npx wrangler secret put ANTHROPIC_API_KEY   # set the API key the Worker needs (do this once per environment)
```

There is no build step for `index.html` — it's served as-is (e.g. via Cloudflare Pages, any static host, or simply opened locally). There are no automated tests or linters in this repo; verify changes by opening `index.html` in a browser and exercising both modes (ingredients → recipe, recipe → tips) against a running/deployed Worker.

## Working in this codebase

- Frontend and backend are edited as single monolithic files (`index.html`, `worker.js`). Keep that structure — don't introduce a build toolchain or split the HTML into a framework app unless explicitly asked.
- If you change the JSON shape the prompt asks Claude for, update `renderResult()` (and vice versa) — they must stay in sync since there's no shared schema/type definition between them.
- `ALLOWED_ORIGIN` in `worker.js` is currently `"*"` by design for pre-launch testing; the file comments that it should be tightened to the real domain before/at launch — don't "fix" this silently as an unrelated cleanup without flagging it, since narrowing it will break any origin not yet accounted for.
- Never hardcode or commit an Anthropic API key; it's read from `env.ANTHROPIC_API_KEY` at runtime via Wrangler secrets.
