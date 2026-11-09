# Retell v3 web calls

Set `VITE_RETELL_PUBLIC_KEY` and `VITE_RETELL_FRONT_DESK_AGENT_ID` before
building. The public key must permit `greenfield-intake.pages.dev` and any
other intended deployment hostname; add `localhost` for local testing.
`VITE_RETELL_OUTBOUND_AGENT_ID` optionally overrides the existing outbound
agent for the web preview. These are public browser values: never put a Retell
secret API key in `VITE_` variables.

The frontend uses `RetellClient.createWebCall` and no longer calls the
backend's legacy `/calls/web` endpoint. If reCAPTCHA is enabled for the key,
the site must also obtain and pass a fresh token before each call; this build
does not yet support that configuration.

Run `npm test` and `npm run build`, then upload `dist` to the existing
Cloudflare Pages project. Build variables are embedded into the static files,
so changing them requires a new build and deploy.
