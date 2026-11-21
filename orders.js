import { initChrome, getStore, getRememberedPurchases, forgetPurchase, money, esc, toast } from './site.js';

const el = (id) => document.getElementById(id);

function parseToken(value) {
  const raw = value.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw, location.origin);
    const fromQuery = url.searchParams.get('token');
    if (fromQuery) return fromQuery;
  } catch { /* not a URL */ }
  if (/^[a-f0-9]{32,128}$/i.test(raw)) return raw;
  return null;
}

function renderSaved() {
  const list = getRememberedPurchases();
  const host = el('saved-list');
  const count = el('saved-count');
  if (count) count.textContent = String(list.length);

  if (!list.length) {
    host.innerHTML = `<p class="muted" style="font-size: .88rem">Nothing here yet. Once you complete a purchase, your ebook will be saved on this device.</p>
      <a class="btn btn--sm" href="/ebooks.html" style="justify-self: start">Browse the collection</a>`;
    return;
  }

  host.innerHTML = list.map((item) => `
    <div class="saved-order" data-token="${esc(item.token)}">
      <img src="${esc(item.cover || '/assets/covers/pinterest.jpg')}" alt="Cover of ${esc(item.title)}" loading="lazy">
      <div>
        <h3>${esc(item.title)}</h3>
        <p>${esc(item.publicId || '')} · ${item.amount != null ? money(item.amount) : ''} ${item.paidAt ? '· ' + new Date(item.paidAt).toLocaleDateString('en-IN') : ''}</p>
      </div>
      <a class="btn btn--sm" href="/order.html?token=${encodeURIComponent(item.token)}">Open ebook</a>
      <button class="btn btn--ghost btn--sm remove-btn" type="button" style="color: inherit; border-color: rgba(246,255,233,.2)">Remove</button>
    </div>`).join('');

  host.querySelectorAll('.remove-btn').forEach((button) => {
    button.addEventListener('click', () => {
      const row = button.closest('.saved-order');
      forgetPurchase(row.dataset.token);
      toast('Removed from this device');
      renderSaved();
    });
  });
}

async function boot() {
  let store = null;
  try { store = await getStore(); } catch { /* optional */ }
  initChrome(store, store?.settings || {});

  const support = el('support-email');
  if (support && store?.settings?.supportEmail) {
    support.href = `mailto:${store.settings.supportEmail}`;
    support.textContent = store.settings.supportEmail;
  }

  renderSaved();

  el('recover-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const box = el('recover-error');
    const token = parseToken(el('recover-input').value);
    if (!token) {
      box.classList.remove('hide');
      box.innerHTML = '<div><strong>That link doesn’t look right</strong>Paste the full purchase link from your confirmation page, or the token on its own.</div>';
      return;
    }
    location.href = `/order.html?token=${encodeURIComponent(token)}`;
  });
}

boot();
