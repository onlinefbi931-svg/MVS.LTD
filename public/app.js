const els = {
  env: document.getElementById('env-badge'),
  warning: document.getElementById('config-warning'),
  form: document.getElementById('push-form'),
  submit: document.getElementById('submit'),
  message: document.getElementById('form-message'),
  list: document.getElementById('transactions'),
  refresh: document.getElementById('refresh'),
};

const POLL_MS = 5000;
let configured = false;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function formatAmount(amount) {
  return `KES ${Number(amount || 0).toLocaleString('en-KE')}`;
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('en-KE');
}

function showMessage(text, kind) {
  els.message.textContent = text;
  els.message.className = `form-message ${kind}`;
  els.message.hidden = false;
}

function clearMessage() {
  els.message.hidden = true;
}

function renderTransaction(record) {
  const details = [
    record.accountReference ? `<span>Ref <b>${escapeHtml(record.accountReference)}</b></span>` : '',
    record.receipt ? `<span>Receipt <b>${escapeHtml(record.receipt)}</b></span>` : '',
    record.createdAt ? `<span>${escapeHtml(formatDate(record.createdAt))}</span>` : '',
  ]
    .filter(Boolean)
    .join('');

  return `
    <li class="txn" data-id="${escapeHtml(record.checkoutRequestId)}">
      <div class="txn-top">
        <span class="txn-amount">${escapeHtml(formatAmount(record.amount))}</span>
        <span class="status ${escapeHtml(record.status)}">${escapeHtml(record.status)}</span>
      </div>
      <div class="txn-phone">${escapeHtml(record.phoneNumber)}</div>
      ${record.message ? `<div class="txn-message">${escapeHtml(record.message)}</div>` : ''}
      <div class="txn-meta">${details}</div>
    </li>
  `;
}

function renderTransactions(records) {
  if (!records.length) {
    els.list.innerHTML = '<li class="empty">No prompts sent yet.</li>';
    return;
  }
  els.list.innerHTML = records.map(renderTransaction).join('');
}

async function loadConfig() {
  try {
    const response = await fetch('/api/config');
    const config = await response.json();

    configured = Boolean(config.configured);
    els.env.textContent = `${config.env === 'production' ? 'Production' : 'Sandbox'}${config.shortcode ? ` · ${config.shortcode}` : ''}`;

    if (configured) {
      els.warning.hidden = true;
    } else {
      els.warning.hidden = false;
      els.warning.textContent =
        `M-Pesa credentials are not set up yet, so prompts cannot be sent. Missing: ${config.missing.join(', ')}.`;
    }
  } catch {
    els.env.textContent = 'offline';
  }
}

async function loadTransactions() {
  try {
    const response = await fetch('/api/transactions');
    const data = await response.json();
    renderTransactions(data.transactions ?? []);
  } catch {
    /* keep the last rendered list when a poll fails */
  }
}

els.form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearMessage();

  const payload = {
    phoneNumber: els.form.phone.value,
    amount: Number(els.form.amount.value),
    accountReference: els.form.reference.value,
    description: els.form.description.value,
  };

  els.submit.disabled = true;
  els.submit.textContent = 'Sending…';

  try {
    const response = await fetch('/api/stkpush', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json();

    if (!response.ok) {
      showMessage(data.error || 'Could not send the prompt.', 'error');
      return;
    }

    showMessage(`Prompt sent to ${data.phoneNumber}. Ask the customer to enter their M-Pesa PIN.`, 'success');
    els.form.phone.value = '';
    await loadTransactions();
  } catch {
    showMessage('Could not reach the server.', 'error');
  } finally {
    els.submit.disabled = false;
    els.submit.textContent = 'Send prompt';
  }
});

els.refresh.addEventListener('click', loadTransactions);

loadConfig().then(loadTransactions);
setInterval(loadTransactions, POLL_MS);
