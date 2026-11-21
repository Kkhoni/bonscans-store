/* Shared storefront helpers: chrome, formatting, product cards, purchases. */

const state = { store: null };
const FALLBACK_NAME = 'Luminae Press';

export const storeName = () => (state.store?.settings?.storeName || '').trim() || FALLBACK_NAME;

export const esc = (value = '') =>
  String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

export function money(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '₹ —';
  return '₹' + Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

export async function getStore(force = false) {
  if (state.store && !force) return state.store;
  const res = await fetch('/api/store', { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('Could not load the store right now.');
  state.store = await res.json();
  return state.store;
}

export const params = new URLSearchParams(location.search);

export function toast(message, type = '') {
  let stack = document.querySelector('.toast-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.className = 'toast-stack';
    document.body.appendChild(stack);
  }
  const node = document.createElement('div');
  node.className = 'toast' + (type ? ` toast--${type}` : '');
  node.textContent = message;
  stack.appendChild(node);
  setTimeout(() => {
    node.style.transition = 'opacity .3s ease, transform .3s ease';
    node.style.opacity = '0';
    node.style.transform = 'translateY(8px)';
    setTimeout(() => node.remove(), 320);
  }, 4200);
}

export function initChrome(store, settings = {}) {
  const name = storeName();
  const shortName = name.split(/\s+/)[0];
  const mark = name.charAt(0).toUpperCase() || 'L';

  document.querySelectorAll('[data-brand]').forEach((node) => { node.textContent = name; });
  document.querySelectorAll('[data-brand-short]').forEach((node) => { node.textContent = shortName; });
  if (document.title.includes(FALLBACK_NAME)) {
    document.title = document.title.replaceAll(FALLBACK_NAME, name);
  }

  const host = document.getElementById('site-header');
  if (host) {
    host.innerHTML = `
      <div class="wrap nav">
        <a class="brand" href="/index.html" aria-label="${esc(name)} home">
          <span class="brand-mark" aria-hidden="true">${esc(mark)}</span>
          <span class="brand-name">${esc(name)}<small>Digital library</small></span>
        </a>
        <nav aria-label="Main">
          <ul class="nav-links" id="nav-links">
            <li><a href="/index.html" data-nav="home">Home</a></li>
            <li><a href="/ebooks.html" data-nav="ebooks">Ebooks</a></li>
            <li><a href="/index.html#about" data-nav="about">About</a></li>
            <li><a href="/index.html#faq" data-nav="faqs">FAQs</a></li>
            <li><a href="/index.html#contact" data-nav="contact">Contact</a></li>
          </ul>
        </nav>
        <div class="nav-actions">
          <a class="btn btn--sm" href="/orders.html">My purchases</a>
          <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="nav-links" aria-label="Toggle menu"><span></span></button>
        </div>
      </div>`;
    const toggle = host.querySelector('.nav-toggle');
    const links = host.querySelector('.nav-links');
    toggle?.addEventListener('click', () => {
      const open = links.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', String(open));
    });
    links?.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => {
      links.classList.remove('is-open');
      toggle?.setAttribute('aria-expanded', 'false');
    }));

    const active = document.body.dataset.page;
    if (active) {
      const match = host.querySelector(`[data-nav="${active}"]`);
      if (match) match.setAttribute('aria-current', 'page');
    }

    const onScroll = () => host.classList.toggle('is-scrolled', window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  const footer = document.getElementById('site-footer');
  if (footer) {
    const email = settings.supportEmail || 'support@yourdomain.com';
    footer.innerHTML = `
      <div class="wrap">
        <div class="footer-grid">
          <div class="footer-brand">
            <a class="brand" href="/index.html">
              <span class="brand-mark" aria-hidden="true">${esc(mark)}</span>
              <span class="brand-name">${esc(name)}<small>Digital library</small></span>
            </a>
            <p>Thoughtfully made ebooks for people building something on the internet. Delivered the moment your payment is verified.</p>
          </div>
          <div class="footer-col">
            <h4>Explore</h4>
            <ul>
              <li><a href="/index.html">Home</a></li>
              <li><a href="/ebooks.html">Ebooks</a></li>
              <li><a href="/index.html#about">About</a></li>
              <li><a href="/index.html#faq">FAQs</a></li>
            </ul>
          </div>
          <div class="footer-col">
            <h4>Support</h4>
            <ul>
              <li><a href="/index.html#contact">Contact us</a></li>
              <li><a href="/orders.html">My purchases</a></li>
              <li><a href="mailto:${esc(email)}">${esc(email)}</a></li>
            </ul>
          </div>
          <div class="footer-col">
            <h4>Payments</h4>
            <p class="footer-note">UPI and cards, secured by Razorpay. Ebooks unlock automatically once the gateway confirms your payment. Prices in INR.</p>
          </div>
        </div>
        <div class="footer-bottom">
          <span>© <span id="footer-year">${new Date().getFullYear()}</span> ${esc(name)}. All rights reserved.</span>
          <span>Digital goods · No physical shipping</span>
        </div>
      </div>`;
  }

  observeReveals();
}

export function productCard(product) {
  const price = product.price === null || product.price === undefined
    ? `<span class="price-amount">₹ —</span><span class="price-note">Price being finalised</span>`
    : `<span class="price-amount">${money(product.price)} <small>INR</small></span><span class="price-note">Instant delivery</span>`;

  const buy = product.available
    ? `<a class="buy-btn" href="/checkout.html?product=${encodeURIComponent(product.slug)}">BUY NOW</a>`
    : `<span class="buy-btn" aria-disabled="true" title="This ebook is not available for purchase yet">NOT AVAILABLE</span>`;

  const flag = !product.hasPdf
    ? `<span class="product-flag">File upload pending</span>`
    : product.price === null
      ? `<span class="product-flag">Price to be set</span>`
      : '';

  return `
    <article class="product-card reveal">
      <div class="product-cover">
        <img src="${esc(product.cover)}" alt="Cover of ${esc(product.title)}" loading="lazy" width="640" height="480">
        <span class="product-cover-tag">PDF ebook</span>
      </div>
      <div class="product-body">
        <span class="product-kicker">${esc(storeName())}</span>
        <h3 class="product-title">${esc(product.title)}</h3>
        ${flag}
        <p class="product-desc">${esc(product.description)}</p>
        <div class="product-foot">
          <div class="price">${price}</div>
          ${buy}
        </div>
      </div>
    </article>`;
}

export function fillCoverStack(products) {
  const images = document.querySelectorAll('.cover-stack .cover-card img');
  products.slice(0, images.length).forEach((product, index) => {
    images[index].src = product.cover;
    images[index].alt = `Cover of ${product.title}`;
  });
}

export function observeReveals() {
  const items = document.querySelectorAll('.reveal:not(.is-visible)');
  if (!items.length || !('IntersectionObserver' in window)) {
    items.forEach((item) => item.classList.add('is-visible'));
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
  items.forEach((item, index) => {
    item.style.transitionDelay = `${Math.min(index % 4, 3) * 70}ms`;
    observer.observe(item);
  });
}

/* Purchases remembered on this device, plus the canonical access link. */
const PURCHASE_KEY = 'luminae.purchases.v1';

export function rememberPurchase(purchase) {
  try {
    const list = getRememberedPurchases();
    const next = [purchase, ...list.filter((item) => item.token !== purchase.token)].slice(0, 20);
    localStorage.setItem(PURCHASE_KEY, JSON.stringify(next));
  } catch { /* storage may be unavailable */ }
}

export function getRememberedPurchases() {
  try {
    const raw = localStorage.getItem(PURCHASE_KEY);
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function forgetPurchase(token) {
  try {
    localStorage.setItem(PURCHASE_KEY, JSON.stringify(getRememberedPurchases().filter((item) => item.token !== token)));
  } catch { /* ignore */ }
}
