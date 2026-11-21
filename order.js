import { initChrome, getStore, money, params, esc, toast, rememberPurchase } from './site.js';

const el = (id) => document.getElementById(id);
const token = params.get('token');

function showError(title, message) {
  const box = el('order-error');
  if (!box) return;
  box.classList.remove('hide');
  box.innerHTML = `<div><strong>${esc(title)}</strong>${message}</div>`;
}

async function loadAccess(showToast = false) {
  const res = await fetch(`/api/access/${encodeURIComponent(token)}`, { cache: 'no-store' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error || 'This purchase link is not valid.');
    error.status = res.status;
    error.data = data;
    throw error;
  }
  return data;
}

async function boot() {
  let store = null;
  try { store = await getStore(); } catch { /* optional */ }
  initChrome(store, store?.settings || {});

  const support = el('support-link');
  if (support && store?.settings?.supportEmail) {
    support.href = `mailto:${store.settings.supportEmail}`;
    support.textContent = store.settings.supportEmail;
  }

  if (!token) {
    el('book-title').textContent = 'No purchase link';
    el('book-sub').textContent = 'Open your ebook from My purchases, or paste your purchase link there.';
    showError('Missing purchase reference', 'Visit <a class="link-quiet" href="/orders.html">My purchases</a> to open your ebook.');
    return;
  }

  let data;
  try {
    data = await loadAccess();
  } catch (error) {
    if (error.status === 403) {
      el('book-title').textContent = 'This ebook is still locked';
      el('book-sub').textContent = 'No verified payment is attached to this order yet.';
      el('access-badge').textContent = '● Awaiting verification';
      el('access-badge').style.background = 'rgba(242,224,164,.5)';
      el('access-badge').style.color = '#7a4b00';
      const status = error.data?.status;
      showError('Payment not confirmed', `Order status: <strong>${esc(status || 'unpaid')}</strong>. Nothing has been unlocked. If you have paid, contact support with your order reference.`);
      return;
    }
    el('book-title').textContent = 'Purchase link not recognised';
    showError('We could not open this purchase', esc(error.message) + ' Check that the full link was copied correctly.');
    return;
  }

  const { order, product, links } = data;
  document.title = `${product.title} — Your purchase`;
  el('book-cover').src = product.cover;
  el('book-cover').alt = `Cover of ${product.title}`;
  el('book-title').textContent = product.title;
  el('book-sub').textContent = product.subtitle || 'Thank you for your purchase.';

  const applyLinks = (payload) => {
    el('read-btn').href = `/read.html?token=${encodeURIComponent(token)}`;
    el('read-btn').removeAttribute('aria-disabled');
    el('download-btn').href = payload.links.downloadUrl;
    el('download-btn').setAttribute('download', payload.links.fileName || '');
    el('download-btn').removeAttribute('aria-disabled');
    const minutes = Math.max(1, Math.round((payload.links.expiresInSeconds || 3600) / 60));
    el('link-note').textContent = `Download links are private to your order and stay valid for about ${minutes} minutes. Tap “Refresh links” any time for a new one.`;
  };
  applyLinks(data);

  const paidOn = order.paidAt ? new Date(order.paidAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
  el('order-meta').innerHTML = `
    <div><span>Order reference</span><strong>${esc(order.publicId)}</strong></div>
    <div><span>Ebook</span><strong>${esc(order.productTitle)}</strong></div>
    <div><span>Amount paid</span><strong>${money(order.amount)}</strong></div>
    <div><span>Paid on</span><strong>${esc(paidOn)}</strong></div>
    <div><span>Downloads</span><strong>${Number(order.downloadCount || 0)}</strong></div>`;

  rememberPurchase({
    token,
    title: product.title,
    cover: product.cover,
    amount: order.amount,
    publicId: order.publicId,
    paidAt: order.paidAt
  });

  el('refresh-links')?.addEventListener('click', async () => {
    try {
      const fresh = await loadAccess();
      applyLinks(fresh);
      toast('Fresh links ready');
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  el('download-btn')?.addEventListener('click', () => {
    // Refresh in the background so the next visit still has a live link.
    setTimeout(() => loadAccess().then(applyLinks).catch(() => {}), 2500);
  });
}

boot();
