import { money, esc, toast } from './site.js';

const el = (id) => document.getElementById(id);
const state = { data: null };

const SECTION_META = {
  overview: ['Overview', 'Live figures from your store.'],
  products: ['Ebooks & files', 'Upload PDFs, set prices and replace covers.'],
  orders: ['Orders', 'Every checkout, its payment state and its private access link.'],
  payments: ['Payments', 'Gateway events, failures and manual verifications.'],
  settings: ['Settings & QR', 'Store details, payment QR and gateway status.']
};

const fmtDate = (value) => (value ? new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const fmtBytes = (bytes) => {
  if (!bytes) return '—';
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
};
const statusChip = (status) => {
  const label = { paid: 'Paid', created: 'Awaiting payment', failed: 'Failed' }[status] || status;
  return `<span class="status-chip status-chip--${esc(status)}">${esc(label)}</span>`;
};

async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
    ...options
  });
  if (res.status === 401) {
    showLogin();
    throw new Error('Administrator sign-in required.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

function showLogin() {
  el('login-view').classList.remove('hide');
  el('dashboard-view').classList.add('hide');
}

function showDashboard() {
  el('login-view').classList.add('hide');
  el('dashboard-view').classList.remove('hide');
}

/* ------------------------------- Overview ------------------------------- */
function renderOverview() {
  const { stats, paymentsConfigured } = state.data;
  el('stat-grid').innerHTML = `
    <div class="stat"><span>Total revenue</span><strong>${money(stats.totalRevenue)}</strong><small>${stats.paidOrders} paid order${stats.paidOrders === 1 ? '' : 's'}</small></div>
    <div class="stat"><span>Average order</span><strong>${stats.paidOrders ? money(stats.averageOrder) : '—'}</strong><small>Across paid ebooks</small></div>
    <div class="stat"><span>Awaiting payment</span><strong>${stats.pendingOrders}</strong><small>Checkouts not completed</small></div>
    <div class="stat"><span>Failed / flagged</span><strong>${stats.failedPayments}</strong><small>Recorded payment problems</small></div>`;

  el('by-product-body').innerHTML = stats.byProduct.map((row) => `
    <tr>
      <td>${esc(row.title)}</td>
      <td>${row.price == null ? '<span class="muted">Not set</span>' : money(row.price)}</td>
      <td>${row.sales}</td>
      <td>${money(row.revenue)}</td>
    </tr>`).join('') || '<tr><td colspan="4" class="admin-empty">No ebooks yet.</td></tr>';

  el('config-body').innerHTML = `
    <div class="stack-sm">
      <div class="status-line"><span class="status-dot ${paymentsConfigured.razorpay ? 'status-dot--ok' : 'status-dot--bad'}"></span>
        <strong>Razorpay:</strong> ${paymentsConfigured.razorpay ? `connected (key ${esc(paymentsConfigured.keyId || '')})` : 'not connected — automatic verification is OFF'}</div>
      <div class="status-line"><span class="status-dot ${paymentsConfigured.webhook ? 'status-dot--ok' : 'status-dot--bad'}"></span>
        <strong>Webhook:</strong> ${paymentsConfigured.webhook ? 'secret configured' : 'RAZORPAY_WEBHOOK_SECRET not set — gateway retries and out-of-band payments will not unlock orders'}</div>
      <div class="status-line"><span class="status-dot status-dot--ok"></span>
        <strong>PDF delivery:</strong> signed, order-bound links (${state.data.products.filter((p) => p.hasPdf).length}/${state.data.products.length} files uploaded)</div>
      ${paymentsConfigured.razorpay && paymentsConfigured.webhook ? '' : `
        <p class="admin-note" style="margin-top: 8px">Until Razorpay and the webhook secret are configured, only manual verification can unlock a UPI payment.
        Add <code>RAZORPAY_KEY_ID</code>, <code>RAZORPAY_KEY_SECRET</code> and <code>RAZORPAY_WEBHOOK_SECRET</code> to <code>.env</code>, then restart the server.</p>`}
    </div>`;

  el('recent-orders-body').innerHTML = state.data.orders.slice(0, 10).map((order) => `
    <tr>
      <td class="mono">${esc(order.publicId)}</td>
      <td>${esc(order.productTitle)}</td>
      <td>${money(order.amount)}</td>
      <td>${statusChip(order.status)}</td>
      <td>${fmtDate(order.createdAt)}</td>
    </tr>`).join('') || '<tr><td colspan="5" class="admin-empty">No orders yet. Share your storefront link to get started.</td></tr>';
}

/* ------------------------------- Products ------------------------------- */
function renderProducts() {
  const host = el('products-list');
  if (!state.data.products.length) {
    host.innerHTML = '<p class="admin-empty">No ebooks. Use “+ Add ebook” to create your first product.</p>';
    return;
  }

  host.innerHTML = state.data.products.map((product) => `
    <div class="admin-product" data-id="${esc(product.id)}">
      <img src="${esc(product.cover)}" alt="Cover of ${esc(product.title)}">
      <div class="admin-product-fields">
        <div class="admin-prod-grid">
          <div class="field">
            <label>Title</label>
            <input data-field="title" value="${esc(product.title)}">
          </div>
          <div class="field">
            <label>Price in INR</label>
            <input data-field="price" type="number" min="0" step="1" placeholder="Not set" value="${product.price ?? ''}">
          </div>
        </div>
        <div class="field">
          <label>Subtitle</label>
          <input data-field="subtitle" value="${esc(product.subtitle || '')}">
        </div>
        <div class="field">
          <label>Description</label>
          <textarea data-field="description" rows="3">${esc(product.description || '')}</textarea>
        </div>
        <div class="file-row">
          <label class="btn btn--ghost btn--sm" style="cursor: pointer">
            ${product.hasPdf ? 'Replace PDF' : 'Upload PDF'}
            <input type="file" accept="application/pdf" data-upload="pdf" hidden>
          </label>
          <span>${product.hasPdf ? `PDF attached · ${fmtBytes(product.pdfSize)} · ${esc(product.pdfOriginalName || '')}` : 'No PDF attached — not purchasable'}</span>
          ${product.hasPdf ? '<button type="button" class="btn btn--ghost btn--sm" data-action="remove-pdf">Remove PDF</button>' : ''}
        </div>
        <div class="file-row">
          <label class="btn btn--ghost btn--sm" style="cursor: pointer">
            Replace cover
            <input type="file" accept="image/png,image/jpeg,image/webp" data-upload="cover" hidden>
          </label>
          <label style="display: inline-flex; align-items: center; gap: 8px; font-size: .8rem; color: rgba(246,255,233,.75)">
            <input type="checkbox" data-field="active" ${product.active ? 'checked' : ''}> Visible in store
          </label>
          <span class="muted" style="font-size: .72rem">${product.available ? '✓ Live &amp; purchasable' : 'Setup incomplete'}</span>
        </div>
      </div>
      <div class="admin-product-actions">
        <button class="btn btn--sm" type="button" data-action="save">Save changes</button>
        <a class="btn btn--ghost btn--sm" href="/checkout.html?product=${encodeURIComponent(product.slug)}" target="_blank" rel="noopener">Preview checkout</a>
        <button class="btn btn--ghost btn--sm" type="button" data-action="delete">Delete ebook</button>
      </div>
    </div>`).join('');

  host.querySelectorAll('.admin-product').forEach(bindProductCard);
}

function bindProductCard(card) {
  const id = card.dataset.id;

  card.querySelector('[data-action="save"]').addEventListener('click', async () => {
    const button = card.querySelector('[data-action="save"]');
    button.disabled = true;
    button.textContent = 'Saving…';
    try {
      await api(`/api/admin/products/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: card.querySelector('[data-field="title"]').value,
          subtitle: card.querySelector('[data-field="subtitle"]').value,
          description: card.querySelector('[data-field="description"]').value,
          price: card.querySelector('[data-field="price"]').value === '' ? null : Number(card.querySelector('[data-field="price"]').value),
          active: card.querySelector('[data-field="active"]').checked
        })
      });
      toast('Ebook updated');
      await loadData();
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      button.disabled = false;
      button.textContent = 'Save changes';
    }
  });

  card.querySelector('[data-action="delete"]').addEventListener('click', async () => {
    if (!confirm('Delete this ebook? Paid customers keep access; removing a product with paid orders is blocked.')) return;
    try {
      await api(`/api/admin/products/${encodeURIComponent(id)}`, { method: 'DELETE' });
      toast('Ebook deleted');
      await loadData();
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  const removePdf = card.querySelector('[data-action="remove-pdf"]');
  removePdf?.addEventListener('click', async () => {
    if (!confirm('Remove the PDF from this ebook? It will no longer be purchasable or downloadable.')) return;
    try {
      await api(`/api/admin/products/${encodeURIComponent(id)}/pdf`, { method: 'DELETE' });
      toast('PDF removed');
      await loadData();
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  card.querySelectorAll('[data-upload]').forEach((input) => {
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      const kind = input.dataset.upload;
      const form = new FormData();
      form.append(kind, file);
      const label = input.closest('label');
      const original = label?.textContent;
      if (label) label.textContent = 'Uploading…';
      try {
        await api(`/api/admin/products/${encodeURIComponent(id)}/${kind}`, { method: 'POST', body: form });
        toast(kind === 'pdf' ? 'PDF uploaded' : 'Cover replaced');
        await loadData();
      } catch (error) {
        toast(error.message, 'error');
        if (label) label.textContent = original;
      }
    });
  });
}

/* ------------------------------- Orders ------------------------------- */
function renderOrders() {
  const filter = el('order-filter')?.value || 'all';
  const orders = state.data.orders.filter((order) => filter === 'all' || order.status === filter);

  el('orders-body').innerHTML = orders.map((order) => {
    const customer = [order.customer?.name, order.customer?.email, order.customer?.phone].filter(Boolean).map(esc).join('<br>') || '<span class="muted">Guest</span>';
    const gateway = [
      order.razorpayOrderId ? `order: <span class="mono">${esc(order.razorpayOrderId)}</span>` : '',
      order.razorpayPaymentId ? `pay: <span class="mono">${esc(order.razorpayPaymentId)}</span>` : '',
      order.paymentSource ? `via ${esc(order.paymentSource)}` : ''
    ].filter(Boolean).join('<br>') || '<span class="muted">—</span>';

    return `
      <tr>
        <td class="mono">${esc(order.publicId)}</td>
        <td>${esc(order.productTitle)}</td>
        <td>${money(order.amount)}</td>
        <td>${statusChip(order.status)}${order.failureReason ? `<div class="admin-note" style="max-width: 180px">${esc(order.failureReason)}</div>` : ''}</td>
        <td>${customer}</td>
        <td>${gateway}</td>
        <td>${fmtDate(order.createdAt)}${order.paidAt ? `<br><span class="muted">paid ${fmtDate(order.paidAt)}</span>` : ''}</td>
        <td style="min-width: 190px">
          <div style="display: grid; gap: 6px">
            ${order.status === 'paid'
              ? `<a class="btn btn--ghost btn--sm" href="${esc(order.accessUrl)}" target="_blank" rel="noopener">Open access page</a>
                 <button class="btn btn--ghost btn--sm" type="button" data-copy="${esc(order.accessUrl)}">Copy access link</button>`
              : `<button class="btn btn--sm" type="button" data-paid="${esc(order.id)}">Mark paid (verified)</button>
                 <button class="btn btn--ghost btn--sm" type="button" data-failed="${esc(order.id)}">Mark failed</button>`}
          </div>
        </td>
      </tr>`;
  }).join('') || '<tr><td colspan="8" class="admin-empty">No orders match this filter.</td></tr>';

  el('orders-body').querySelectorAll('[data-copy]').forEach((button) => {
    button.addEventListener('click', async () => {
      const url = `${location.origin}${button.dataset.copy}`;
      try {
        await navigator.clipboard.writeText(url);
        toast('Access link copied');
      } catch {
        toast('Copy failed — open the link and copy the address bar', 'error');
      }
    });
  });

  el('orders-body').querySelectorAll('[data-paid]').forEach((button) => {
    button.addEventListener('click', async () => {
      const note = prompt('Confirm the UPI/bank transfer reference you verified (required):');
      if (!note) return;
      try {
        await api(`/api/admin/orders/${encodeURIComponent(button.dataset.paid)}/mark-paid`, {
          method: 'POST',
          body: JSON.stringify({ note })
        });
        toast('Order unlocked');
        await loadData();
      } catch (error) {
        toast(error.message, 'error');
      }
    });
  });

  el('orders-body').querySelectorAll('[data-failed]').forEach((button) => {
    button.addEventListener('click', async () => {
      const note = prompt('Reason for marking this order failed:') || 'Marked failed by administrator';
      try {
        await api(`/api/admin/orders/${encodeURIComponent(button.dataset.failed)}/mark-failed`, {
          method: 'POST',
          body: JSON.stringify({ note })
        });
        toast('Order marked failed');
        await loadData();
      } catch (error) {
        toast(error.message, 'error');
      }
    });
  });
}

/* ------------------------------- Payments ------------------------------- */
function renderPayments() {
  el('payments-body').innerHTML = state.data.payments.map((payment) => `
    <tr>
      <td>${fmtDate(payment.at)}</td>
      <td class="mono">${esc(payment.publicId || '—')}</td>
      <td class="mono">${esc(payment.gatewayPaymentId || '—')}</td>
      <td>${esc(payment.event)}</td>
      <td>${payment.amountPaise == null ? '—' : money(payment.amountPaise / 100)}</td>
      <td>${statusChip(payment.status)}</td>
      <td>${esc(payment.source)}</td>
      <td style="max-width: 280px"><span class="admin-note">${esc(payment.note || '—')}</span></td>
    </tr>`).join('') || '<tr><td colspan="8" class="admin-empty">No payment events recorded yet.</td></tr>';
}

/* ------------------------------- Settings ------------------------------- */
function renderSettings() {
  const { settings, paymentsConfigured } = state.data;
  const storeName = (settings.storeName || '').trim() || 'Luminae Press';
  document.title = document.title.replaceAll('Luminae Press', storeName);
  document.querySelectorAll('.brand-name').forEach((node) => {
    if (node.firstChild && node.firstChild.nodeType === Node.TEXT_NODE) node.firstChild.textContent = storeName;
  });
  el('setting-store').value = settings.storeName || '';
  el('setting-upi').value = settings.upiId || '';
  el('setting-email').value = settings.supportEmail || '';
  el('setting-phone').value = settings.supportPhone || '';
  el('qr-preview').src = settings.upiQr || '/assets/upi-qr.webp';

  el('gateway-config').innerHTML = `
    <div class="stack-sm">
      <div class="status-line"><span class="status-dot ${paymentsConfigured.razorpay ? 'status-dot--ok' : 'status-dot--bad'}"></span>
        Razorpay key: ${paymentsConfigured.razorpay ? `<span class="mono">${esc(paymentsConfigured.keyId)}</span>` : 'not configured'}</div>
      <div class="status-line"><span class="status-dot ${paymentsConfigured.webhook ? 'status-dot--ok' : 'status-dot--bad'}"></span>
        Webhook secret: ${paymentsConfigured.webhook ? 'configured' : 'not configured'}</div>
      <div class="divider"></div>
      <p class="admin-note">
        Set these environment variables in <code>.env</code> (or your host’s secret manager) and restart the server:<br>
        <code>RAZORPAY_KEY_ID</code>, <code>RAZORPAY_KEY_SECRET</code>, <code>RAZORPAY_WEBHOOK_SECRET</code>.<br>
        In the Razorpay dashboard add a webhook pointing to <code>/api/webhooks/razorpay</code> with the events
        <code>payment.captured</code>, <code>payment.failed</code> and <code>order.paid</code>.
        For local testing, expose the server with a tunnel and use that public URL.
      </p>
      <p class="admin-note">Gateway payments are verified server-side (HMAC signature + amount + capture status) before any file unlocks. The static UPI QR is never treated as proof of payment.</p>
    </div>`;
}

/* ------------------------------- Wiring ------------------------------- */
function renderAll() {
  renderOverview();
  renderProducts();
  renderOrders();
  renderPayments();
  renderSettings();
}

async function loadData() {
  state.data = await api('/api/admin/data');
  renderAll();
}

function switchSection(name) {
  document.querySelectorAll('.admin-nav button').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.section === name);
  });
  document.querySelectorAll('.admin-section').forEach((section) => {
    section.classList.toggle('is-active', section.id === `section-${name}`);
  });
  const [title, sub] = SECTION_META[name] || SECTION_META.overview;
  el('section-title').textContent = title;
  el('section-sub').textContent = sub;
}

function bind() {
  el('login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = el('login-button');
    const errorBox = el('login-error');
    errorBox.textContent = '';
    button.disabled = true;
    button.textContent = 'Signing in…';
    try {
      await api('/api/admin/login', {
        method: 'POST',
        body: JSON.stringify({ password: el('admin-password').value })
      });
      el('admin-password').value = '';
      showDashboard();
      await loadData();
    } catch (error) {
      errorBox.textContent = error.message;
    } finally {
      button.disabled = false;
      button.textContent = 'Sign in';
    }
  });

  el('logout-button').addEventListener('click', async () => {
    try { await api('/api/admin/logout', { method: 'POST', body: '{}' }); } catch { /* ignore */ }
    showLogin();
  });

  document.querySelectorAll('.admin-nav button').forEach((button) => {
    button.addEventListener('click', () => switchSection(button.dataset.section));
  });

  el('refresh-button').addEventListener('click', async () => {
    try {
      await loadData();
      toast('Data refreshed');
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  el('add-product').addEventListener('click', async () => {
    try {
      await api('/api/admin/products', { method: 'POST', body: '{}' });
      switchSection('products');
      await loadData();
      toast('Ebook created — add a title, price and PDF');
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  el('order-filter').addEventListener('change', renderOrders);

  el('settings-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await api('/api/admin/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          storeName: el('setting-store').value,
          upiId: el('setting-upi').value,
          supportEmail: el('setting-email').value,
          supportPhone: el('setting-phone').value
        })
      });
      toast('Store details saved');
      await loadData();
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  el('qr-file').addEventListener('change', () => {
    const file = el('qr-file').files?.[0];
    el('qr-file-name').textContent = file ? `${file.name} · ${fmtBytes(file.size)}` : 'PNG, JPG or WebP';
  });

  el('qr-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const file = el('qr-file').files?.[0];
    if (!file) {
      toast('Choose a QR image first', 'error');
      return;
    }
    const form = new FormData();
    form.append('qr', file);
    try {
      await api('/api/admin/qr', { method: 'POST', body: form });
      el('qr-file').value = '';
      el('qr-file-name').textContent = 'PNG, JPG or WebP';
      toast('Payment QR replaced');
      await loadData();
    } catch (error) {
      toast(error.message, 'error');
    }
  });
}

async function boot() {
  bind();
  try {
    const session = await fetch('/api/admin/session', { credentials: 'same-origin' }).then((res) => res.json());
    if (session.authenticated) {
      showDashboard();
      await loadData();
    } else {
      showLogin();
    }
  } catch {
    showLogin();
  }
}

boot();
