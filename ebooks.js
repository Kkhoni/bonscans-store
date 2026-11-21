import { getStore, initChrome, productCard, observeReveals } from './site.js';

async function boot() {
  const store = await getStore();
  initChrome(store, store.settings);

  const grid = document.getElementById('product-grid');
  if (grid) {
    grid.innerHTML = store.products.map(productCard).join('');
    observeReveals();
  }

  const email = document.getElementById('support-email');
  if (email && store.settings.supportEmail) {
    email.textContent = store.settings.supportEmail;
    email.href = `mailto:${store.settings.supportEmail}`;
  }
}

boot().catch((error) => {
  console.error(error);
  initChrome(null, {});
  const grid = document.getElementById('product-grid');
  if (grid) grid.innerHTML = '<p class="muted">The collection could not be loaded. Please refresh in a moment.</p>';
});
