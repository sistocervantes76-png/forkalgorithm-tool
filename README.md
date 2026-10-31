# forkalgorithm-tool

- **Recipe site** (repository root): `public/` served by `worker.js`, deployed with `npm run deploy` here. The root `wrangler.toml` is the only config for this Worker; don't add a `wrangler.json`/`wrangler.jsonc` beside it, because Wrangler prefers those and would upload the whole repo (including `node_modules`) as assets.
- **Agent Command Center** (`command-center/`): the founder's private control panel for the AI Chief of Staff and agent team. It is a separate Worker with its own D1 database. See [command-center/README.md](command-center/README.md), [DEPLOYMENT.md](command-center/DEPLOYMENT.md) and [STATUS.md](command-center/STATUS.md).
