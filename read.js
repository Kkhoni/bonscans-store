import { params } from './site.js';

const el = (id) => document.getElementById(id);

function fail(title, message) {
  el('reader-frame').classList.add('hide');
  const fallback = el('reader-fallback');
  fallback.classList.remove('hide');
  el('reader-error-title').textContent = title;
  el('reader-error-text').textContent = message;
  el('reader-title').textContent = 'Ebook unavailable';
}

async function boot() {
  const token = params.get('token');
  if (!token) {
    fail('No purchase link', 'Open this reader from your purchase confirmation page.');
    return;
  }

  el('back-link').href = `/order.html?token=${encodeURIComponent(token)}`;

  try {
    const res = await fetch(`/api/access/${encodeURIComponent(token)}`, { cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      fail(
        res.status === 403 ? 'This ebook is still locked' : 'We couldn’t load this ebook',
        data.error || 'Open your purchase page to check the order status.'
      );
      return;
    }

    const { product, links } = data;
    document.title = `${product.title} — Reader`;
    el('reader-title').textContent = product.title;

    const download = el('reader-download');
    download.href = links.downloadUrl;
    download.setAttribute('download', links.fileName || '');
    download.removeAttribute('aria-disabled');

    const frame = el('reader-frame');
    frame.src = `${links.readerUrl}#view=FitH`;
    frame.addEventListener('error', () => {
      fail('The reader could not display this PDF', 'Download the ebook instead — it will open in your device’s PDF app.');
    });
  } catch (error) {
    fail('We couldn’t open this ebook', error.message || 'Check your connection and try again.');
  }
}

boot();
