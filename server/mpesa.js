/**
 * Safaricom M-Pesa (Daraja) client.
 *
 * Covers the three calls the app needs:
 *   - OAuth access token
 *   - STK Push (Lipa Na M-Pesa Online) request
 *   - STK Push query (check the result of a prompt)
 *
 * Configuration is read lazily from the environment so the app can boot and
 * serve its UI before credentials exist; only sending a prompt requires them.
 */

const BASE_URLS = {
  sandbox: 'https://sandbox.safaricom.co.ke',
  production: 'https://api.safaricom.co.ke',
};

const REQUEST_TIMEOUT_MS = 20000;

const REQUIRED_SETTINGS = [
  ['consumerKey', 'MPESA_CONSUMER_KEY'],
  ['consumerSecret', 'MPESA_CONSUMER_SECRET'],
  ['shortcode', 'MPESA_SHORTCODE'],
  ['passkey', 'MPESA_PASSKEY'],
];

function trimmed(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/** Public callback URL Safaricom posts the prompt result to. */
export function defaultCallbackUrl() {
  const explicit = trimmed(process.env.PUBLIC_BASE_URL);
  if (explicit) return `${explicit.replace(/\/+$/, '')}/api/mpesa/callback`;

  const suffix = trimmed(process.env.BASE44_PUBLIC_HOST_SUFFIX);
  if (suffix) return `https://3000-${suffix}/api/mpesa/callback`;

  return `http://localhost:${process.env.PORT || 3000}/api/mpesa/callback`;
}

export function getConfig() {
  const env = (trimmed(process.env.MPESA_ENV) || 'sandbox').toLowerCase();

  return {
    env,
    baseUrl: trimmed(process.env.MPESA_BASE_URL) || BASE_URLS[env] || BASE_URLS.sandbox,
    consumerKey: trimmed(process.env.MPESA_CONSUMER_KEY),
    consumerSecret: trimmed(process.env.MPESA_CONSUMER_SECRET),
    shortcode: trimmed(process.env.MPESA_SHORTCODE),
    passkey: trimmed(process.env.MPESA_PASSKEY),
    transactionType: trimmed(process.env.MPESA_TRANSACTION_TYPE) || 'CustomerPayBillOnline',
    callbackUrl: trimmed(process.env.MPESA_CALLBACK_URL) || defaultCallbackUrl(),
  };
}

export function missingSettings(config = getConfig()) {
  return REQUIRED_SETTINGS.filter(([key]) => !config[key]).map(([, name]) => name);
}

export function isConfigured(config = getConfig()) {
  return missingSettings(config).length === 0;
}

/** Show only the head and tail of the shortcode in the UI. */
export function maskShortcode(shortcode) {
  if (!shortcode) return '';
  if (shortcode.length <= 4) return shortcode;
  return `${shortcode.slice(0, 3)}•••${shortcode.slice(-2)}`;
}

/**
 * Safaricom expects 2547XXXXXXXX. Accepts 07…, 01…, 7…, 254… and +254…
 * Returns null when the number is not a Safaricom mobile number.
 */
export function normalizePhone(input) {
  const digits = String(input ?? '').replace(/\D/g, '');
  if (/^0(7|1)\d{8}$/.test(digits)) return `254${digits.slice(1)}`;
  if (/^(7|1)\d{8}$/.test(digits)) return `254${digits}`;
  if (/^254(7|1)\d{8}$/.test(digits)) return digits;
  return null;
}

/** Daraja timestamps are East Africa Time (UTC+3), formatted YYYYMMDDHHmmss. */
export function timestampEat(date = new Date()) {
  const eat = new Date(date.getTime() + 3 * 60 * 60 * 1000);
  const pad = (value) => String(value).padStart(2, '0');
  return [
    eat.getUTCFullYear(),
    pad(eat.getUTCMonth() + 1),
    pad(eat.getUTCDate()),
    pad(eat.getUTCHours()),
    pad(eat.getUTCMinutes()),
    pad(eat.getUTCSeconds()),
  ].join('');
}

function stkPassword(shortcode, passkey, timestamp) {
  return Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');
}

async function callSafaricom(url, options) {
  let response;
  try {
    response = await fetch(url, { ...options, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (error) {
    throw new Error(
      error.name === 'TimeoutError'
        ? 'Safaricom did not respond in time. Try again.'
        : `Could not reach Safaricom (${error.message}).`,
    );
  }

  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }

  if (!response.ok) {
    const raw = typeof body?.raw === 'string' ? body.raw : '';
    // Safaricom's edge protection answers with an HTML challenge page; never
    // surface that markup to the user.
    const blocked = /^\s*</.test(raw);
    const message =
      body?.errorMessage ||
      body?.ResponseDescription ||
      (blocked ? `Safaricom rejected the request (HTTP ${response.status}).` : raw) ||
      `Safaricom returned HTTP ${response.status}`;
    throw new Error(String(message).slice(0, 300));
  }

  return body;
}

export async function getAccessToken(config = getConfig()) {
  const credentials = Buffer.from(`${config.consumerKey}:${config.consumerSecret}`).toString('base64');
  const body = await callSafaricom(
    `${config.baseUrl}/oauth/v1/generate?grant_type=client_credentials`,
    { method: 'GET', headers: { Authorization: `Basic ${credentials}` } },
  );

  if (!body.access_token) throw new Error('Safaricom did not return an access token.');
  return body.access_token;
}

export async function initiateStkPush({ phoneNumber, amount, accountReference, description }, config = getConfig()) {
  const token = await getAccessToken(config);
  const timestamp = timestampEat();

  return callSafaricom(`${config.baseUrl}/mpesa/stkpush/v1/processrequest`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      BusinessShortCode: config.shortcode,
      Password: stkPassword(config.shortcode, config.passkey, timestamp),
      Timestamp: timestamp,
      TransactionType: config.transactionType,
      Amount: amount,
      PartyA: phoneNumber,
      PartyB: config.shortcode,
      PhoneNumber: phoneNumber,
      CallBackURL: config.callbackUrl,
      AccountReference: accountReference,
      TransactionDesc: description,
    }),
  });
}

export async function queryStkPush(checkoutRequestId, config = getConfig()) {
  const token = await getAccessToken(config);
  const timestamp = timestampEat();

  return callSafaricom(`${config.baseUrl}/mpesa/stkpushquery/v1/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      BusinessShortCode: config.shortcode,
      Password: stkPassword(config.shortcode, config.passkey, timestamp),
      Timestamp: timestamp,
      CheckoutRequestID: checkoutRequestId,
    }),
  });
}

/** Flatten the callback Safaricom posts to CallBackURL. */
export function parseCallback(body) {
  const callback = body?.Body?.stkCallback;
  if (!callback) return null;

  const items = callback.CallbackMetadata?.Item ?? [];
  const metadata = Object.fromEntries(items.map((item) => [item.Name, item.Value]));

  return {
    merchantRequestId: callback.MerchantRequestID,
    checkoutRequestId: callback.CheckoutRequestID,
    resultCode: callback.ResultCode,
    resultDesc: callback.ResultDesc,
    amount: metadata.Amount ?? null,
    receipt: metadata.MpesaReceiptNumber ?? null,
    paidAt: metadata.TransactionDate ?? null,
    phoneNumber: metadata.PhoneNumber ? String(metadata.PhoneNumber) : null,
  };
}
