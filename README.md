# MVS.LTD — Safaricom STK Push

Sends an M-Pesa **STK Push** (Lipa Na M-Pesa Online) payment prompt to a customer's
phone and shows the result of each prompt as Safaricom reports it back.

- `server/` — Express API: sends prompts, receives Safaricom's callback, exposes the transaction list
- `public/` — single-page console: phone/amount form plus a live transaction list

## Running it

```bash
docker compose -f docker-compose.base44.yml up -d --build
open http://localhost:3000
```

The compose file runs the app from the source with Node's watch mode, so code
edits reload without a rebuild.

## Configuration

The app **starts without any credentials** — the UI loads, shows which settings are
missing, and refuses to send prompts until they are supplied. The M-Pesa settings are:

| Variable | Purpose |
| --- | --- |
| `MPESA_ENV` | `sandbox` (default) or `production` |
| `MPESA_CONSUMER_KEY` | Daraja consumer key |
| `MPESA_CONSUMER_SECRET` | Daraja consumer secret |
| `MPESA_SHORTCODE` | Paybill/Till shortcode |
| `MPESA_PASSKEY` | Lipa Na M-Pesa Online passkey |
| `MPESA_CALLBACK_URL` | Optional; defaults to `<preview URL>/api/mpesa/callback` |
| `MPESA_TRANSACTION_TYPE` | Defaults to `CustomerPayBillOnline` (`CustomerBuyGoodsOnline` for Till) |

Values supplied through the app's secrets are delivered to `/run/base44/app.env`,
which compose loads after `.env.base44-defaults` so dashboard values always win.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/config` | Which environment/shortcode is active and what is still missing |
| `POST` | `/api/stkpush` | Send a prompt (`phoneNumber`, `amount`, `accountReference`, `description`) |
| `POST` | `/api/mpesa/callback` | Safaricom's result callback (must stay public) |
| `GET` | `/api/transactions` | Prompts sent since the service started |
| `POST` | `/api/transactions/:checkoutRequestId/query` | Ask Safaricom for the current state of a prompt |

Prompt records are kept in memory, so restarting the service clears the list.
