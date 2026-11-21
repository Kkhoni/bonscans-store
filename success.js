import { initChrome, getStore, money, params, esc, toast, rememberPurchase } from './site.js';

const el = (id) => document.getElementById(id);

function showError(title, message) {
  const box = el('success-error');
  if (!box) return;
  box.classList.remove('hide');
  box.innerHTML = `<div><strong>${esc(title)}</strong>${message}</div>`;
}

async function boot() {
  let store = null;
  try {
    store = await getStore();
  } catch { /* header still renders without store data */ }
  initChrome(store, store?.settings || {});

  const token = params.get('token');
  if (!token) {
    el('book-title').textContent = 'No purchase link found';
    showError('This page is for completed purchases', 'Open your purchase link, or visit <a class="link-quiet" href="/orders.html">My purchases</a> to find your ebook.');
    el('read-btn').setAttribute('aria-disabled', 'true');
    el('download-btn').setAttribute('aria-disabled', 'true');
    return;
  }

  let data;
  try {
    const res = await fetch(`/api/access/${encodeURIComponent(token)}`, { cache: 'no-store' });
    data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 403) {
        el('book-title').textContent = 'Payment not verified yet';
        showError('This order is not unlocked', `The store has not confirmed a payment for this order. <a class="link-quiet" href="/order.html?token=${encodeURIComponent(token)}">Open the order page</a> to check its status.`);
        return;
      }
      throw new Error(data.error || 'This purchase link is not valid.');
    }
  } catch (error) {
    el('book-title').textContent = 'We could not load your purchase';
    showError('Something went wrong', esc(error.message) + ' Please refresh, or contact support with your order reference.');
    return;
  }

  const { order, product, links } = data;
  document.title = `${product.title} — Your ebook`;

  el('book-cover').src = product.cover;
  el('book-cover').alt = `Cover of ${product.title}`;
  el('book-title').textContent = product.title;

  const readBtn = el('read-btn');
  const downloadBtn = el('download-btn');
  readBtn.href = `/read.html?token=${encodeURIComponent(token)}`;
  readBtn.removeAttribute('aria-disabled');
  downloadBtn.href = links.downloadUrl;
  downloadBtn.setAttribute('download', links.fileName || '');
  downloadBtn.removeAttribute('aria-disabled');

  const paidOn = order.paidAt ? new Date(order.paidAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
  el('order-meta').innerHTML = `
    <div><span>Order reference</span><strong>${esc(order.publicId)}</strong></div>
    <div><span>Ebook</span><strong>${esc(order.productTitle)}</strong></div>
    <div><span>Amount paid</span><strong>${money(order.amount)}</strong></div>
    <div><span>Paid on</span><strong>${esc(paidOn)}</strong></div>
    <div><span>Status</span><strong>Verified &amp; unlocked</strong></div>`;

  const minutes = Math.max(1, Math.round((links.expiresInSeconds || 3600) / 60));
  el('link-note').textContent = `These download links stay valid for ${minutes} minutes. Reopen your purchase page for a fresh link at any time.`;

  rememberPurchase({
    token,
    title: product.title,
    cover: product.cover,
    amount: order.amount,
    publicId: order.publicId,
    paidAt: order.paidAt
  });

  el('copy-link')?.addEventListener('click', async () => {
    const url = `${location.origin}/order.html?token=${encodeURIComponent(token)}`;
    try {
      await navigator.clipboard.writeText(url);
      toast('Purchase link copied');
    } catch {
      toast('Copy failed — long-press the address bar to copy the link', 'error');
    }
  });
}

boot();
