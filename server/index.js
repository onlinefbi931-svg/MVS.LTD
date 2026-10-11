import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';

import {
  getConfig,
  initiateStkPush,
  isConfigured,
  maskShortcode,
  missingSettings,
  normalizePhone,
  parseCallback,
  queryStkPush,
} from './mpesa.js';
import {
  getTransaction,
  listTransactions,
  saveTransaction,
  updateTransaction,
} from './store.js';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const port = Number(process.env.PORT || 3000);

const app = express();
app.use(express.json({ limit: '100kb' }));

/** Current M-Pesa setup, safe to expose (no secrets). */
app.get('/api/config', (req, res) => {
  const config = getConfig();
  res.json({
    env: config.env,
    configured: isConfigured(config),
    missing: missingSettings(config),
    shortcode: maskShortcode(config.shortcode),
    transactionType: config.transactionType,
    callbackUrl: config.callbackUrl,
  });
});

/** Send an STK Push prompt to a customer's phone. */
app.post('/api/stkpush', async (req, res) => {
  const phoneNumber = normalizePhone(req.body?.phoneNumber);
  const amount = Number(req.body?.amount);
  const accountReference = (String(req.body?.accountReference ?? '').trim() || 'MVS.LTD').slice(0, 12);
  const description = (String(req.body?.description ?? '').trim() || 'Payment').slice(0, 13);

  if (!phoneNumber) {
    return res.status(400).json({ error: 'Enter a valid Safaricom number, for example 0712345678.' });
  }
  if (!Number.isInteger(amount) || amount < 1 || amount > 250000) {
    return res.status(400).json({ error: 'Amount must be a whole number between 1 and 250000 KES.' });
  }

  const config = getConfig();
  const missing = missingSettings(config);

  if (missing.length) {
    return res.status(503).json({
      error: `M-Pesa credentials are not configured yet. Missing: ${missing.join(', ')}.`,
    });
  }

  try {
    const response = await initiateStkPush({ phoneNumber, amount, accountReference, description }, config);
    const now = new Date().toISOString();

    const record = saveTransaction({
      checkoutRequestId: response.CheckoutRequestID,
      merchantRequestId: response.MerchantRequestID,
      phoneNumber,
      amount,
      accountReference,
      description,
      status: response.ResponseCode === '0' ? 'pending' : 'failed',
      message: response.CustomerMessage || response.ResponseDescription || '',
      receipt: null,
      resultCode: null,
      resultDesc: null,
      createdAt: now,
      updatedAt: now,
    });

    res.status(202).json(record);
  } catch (error) {
    console.error('[stkpush] failed:', error.message);
    res.status(502).json({ error: error.message });
  }
});

/** Result callback Safaricom posts once the customer responds to the prompt. */
app.post('/api/mpesa/callback', (req, res) => {
  const parsed = parseCallback(req.body);
  console.log('[callback]', JSON.stringify(req.body));

  if (parsed?.checkoutRequestId) {
    updateTransaction(parsed.checkoutRequestId, {
      status: parsed.resultCode === 0 || parsed.resultCode === '0' ? 'success' : 'failed',
      resultCode: parsed.resultCode ?? null,
      resultDesc: parsed.resultDesc ?? null,
      receipt: parsed.receipt,
      paidAt: parsed.paidAt,
      phoneNumber: parsed.phoneNumber ?? undefined,
      message: parsed.resultDesc ?? '',
    });
  }

  // Safaricom requires a plain acknowledgement.
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
});

app.get('/api/transactions', (req, res) => {
  res.json({ transactions: listTransactions() });
});

/** Ask Safaricom for the current state of a prompt (used for pending rows). */
app.post('/api/transactions/:checkoutRequestId/query', async (req, res) => {
  const config = getConfig();
  if (!isConfigured(config)) {
    return res.status(503).json({ error: 'M-Pesa credentials are not configured yet.' });
  }

  const record = getTransaction(req.params.checkoutRequestId);
  if (!record) return res.status(404).json({ error: 'Unknown transaction.' });

  try {
    const response = await queryStkPush(record.checkoutRequestId, config);
    const resultCode = response.ResultCode;

    const patch = {
      resultCode: resultCode ?? null,
      resultDesc: response.ResultDesc ?? null,
      message: response.ResultDesc || response.ResponseDescription || record.message,
    };
    if (resultCode !== undefined && resultCode !== null && String(resultCode) !== '') {
      patch.status = String(resultCode) === '0' ? 'success' : 'failed';
    }

    res.json(updateTransaction(record.checkoutRequestId, patch));
  } catch (error) {
    console.error('[query] failed:', error.message);
    res.status(502).json({ error: error.message });
  }
});

app.use(express.static(publicDir));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

app.get('*', (req, res) => res.sendFile(path.join(publicDir, 'index.html')));

app.listen(port, '0.0.0.0', () => {
  console.log(`MVS.LTD STK Push app listening on http://0.0.0.0:${port}`);
});
