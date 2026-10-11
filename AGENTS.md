# AGENTS.md

## Stack

Node 22 + Express, no build step and no database. The server serves the API and
the static frontend (`public/`) from the same process on port 3000.

## Running it

```bash
docker compose -f docker-compose.base44.yml up -d
curl -s http://localhost:3000/api/config
```

`node --watch` restarts the server on file changes, so backend edits apply
without a rebuild; frontend files are read from disk per request.

## Things that are easy to get wrong

- **Dependencies are installed at container start**, not in the image: the
  command runs `npm ci` from the committed `package-lock.json` into the
  `web_node_modules` volume. After changing `package.json`, regenerate the
  lockfile or `npm ci` will fail:
  `docker run --rm -v "$PWD":/app -w /app node:22 npm install --package-lock-only`
- **The app is designed to boot without credentials.** M-Pesa settings are read
  lazily, so nothing needs to exist at startup. `GET /api/config` reports which
  settings are missing — it is also what the compose healthcheck probes, so
  don't remove or gate it behind credentials.
- **Credentials must never be read from `environment:`** in compose. Real values
  come from `/run/base44/app.env` (listed last in `env_file:`) so dashboard
  values override `.env.base44-defaults`.
- **The callback URL is derived at runtime** from `BASE44_PUBLIC_HOST_SUFFIX`
  (`https://3000-<suffix>/api/mpesa/callback`) because the sandbox host changes
  between sessions. `MPESA_CALLBACK_URL` overrides it; `PUBLIC_BASE_URL` is the
  generic alternative. Safaricom can only reach it while the preview is public.
- **Transactions are stored in memory** (`server/store.js`), capped at 100. A
  restart clears them; that is intentional for this ops console.

## Verifying changes

1. `curl -s http://localhost:3000/api/config` — expect `configured: false` with a
   `missing` list until credentials are supplied.
2. `curl -s -X POST http://localhost:3000/api/stkpush -H 'Content-Type: application/json' -d '{"phoneNumber":"0712345678","amount":1}'`
   — with no credentials this must return HTTP 503 and the missing variable
   names; with credentials it returns HTTP 202 and a `checkoutRequestId`.
3. `curl -s -X POST http://localhost:3000/api/mpesa/callback -H 'Content-Type: application/json' -d '{"Body":{"stkCallback":{"CheckoutRequestID":"x","ResultCode":0,"ResultDesc":"ok"}}}'`
   — must return `{"ResultCode":0,"ResultDesc":"Accepted"}`.

Safaricom's sandbox test number for a prompt that succeeds is `254708374149`.

### Known obstacle: Safaricom edge protection blocks the prompt POST from cloud IPs

Verified from the Base44 sandbox with valid sandbox credentials: the OAuth call
succeeds (HTTP 200, token returned) while the STK Push POST to
`/mpesa/stkpush/v1/processrequest` is answered by Safaricom's Imperva/Incapsula
edge with **HTTP 403** (an HTML challenge page) or simply stalls past the client
timeout. The app surfaces this as `Safaricom rejected the request (HTTP 403).` /
`Safaricom did not respond in time.`

This is an egress-IP block on Safaricom's side, not a credentials or code
problem: the same request from an ordinary/allowlisted network reaches Daraja.
Do not "fix" it by loosening timeouts or retrying in a loop.
