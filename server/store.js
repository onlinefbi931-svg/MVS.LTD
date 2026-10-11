/**
 * In-memory transaction store.
 *
 * The app is a demo/ops console for sending STK Push prompts, so prompt records
 * live in memory only: they are listed with their status and receipts while the
 * service runs. Restarting the service clears the list.
 */

const MAX_RECORDS = 100;
const transactions = new Map();

export function saveTransaction(record) {
  transactions.set(record.checkoutRequestId, record);

  while (transactions.size > MAX_RECORDS) {
    transactions.delete(transactions.keys().next().value);
  }

  return record;
}

export function getTransaction(checkoutRequestId) {
  return transactions.get(checkoutRequestId) ?? null;
}

export function updateTransaction(checkoutRequestId, patch) {
  const existing = transactions.get(checkoutRequestId);
  if (!existing) return null;

  const updated = { ...existing, ...patch, updatedAt: new Date().toISOString() };
  transactions.set(checkoutRequestId, updated);
  return updated;
}

export function listTransactions() {
  return [...transactions.values()].reverse();
}
