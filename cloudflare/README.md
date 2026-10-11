# Cloudflare Gemini API

This Worker is the private-key API backend for the public GitHub Pages front end. It does not host pages or persist images/results. It stores only hashed client IP identifiers as Durable Object names and the timestamps of that IP's recent analysis attempts; timestamps older than one hour are removed before each check.

## Deploy on the Cloudflare Free plan

1. Create or sign in to a Cloudflare account and a Google AI Studio project. Use a Gemini API key on the free tier; do not attach a paid billing plan if the service must remain no-charge.
2. From the repository root, authenticate Wrangler: `npx wrangler login`.
3. Deploy the Worker and create its SQLite Durable Object namespace: `npx wrangler deploy --config cloudflare/wrangler.toml`.
4. Add the Gemini key as a Cloudflare secret: `npx wrangler secret put GEMINI_API_KEY --config cloudflare/wrangler.toml`. Wrangler prompts for the value; do not put it in a file or command argument. Deploy again after adding the secret.
5. In the GitHub repository, add Actions repository variable `ANALYSIS_API_URL` with the Worker HTTPS origin, for example `https://style-sampler-analysis.<your-account>.workers.dev` (no path or trailing slash), then rerun the Pages workflow.

The browser only receives the public Worker URL. Gemini is called server-to-server using the Worker secret. CORS allows only `https://ltwyz55-a11y.github.io`.

## API

- `GET /api/status` returns `{ "ready": boolean }`.
- `POST /api/analyze` accepts the existing `{ images, subject, consent: true }` payload and returns `{ result }` in the page's bilingual report format.
- Each valid, consented analysis attempt counts toward a rolling limit of five per source IP in the preceding hour. Failed Gemini requests also count. The sixth returns `429` and a `Retry-After` header.

The request body's images are sent to Google Gemini on the free tier, where Google may use submitted content to improve products. The page obtains consent before sending them. This site does not retain image data or analysis results; Cloudflare retains only the short-lived rate-limit counters described above. Provider quota exhaustion disables analysis until quota becomes available; there is no paid fallback.
