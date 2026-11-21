import { getStore, initChrome, productCard, fillCoverStack, observeReveals, esc } from './site.js';

async function boot() {
  let store;
  try {
    store = await getStore();
  } catch (error) {
    console.error(error);
    initChrome(null, {});
    return;
  }

  initChrome(store, store.settings);
  fillCoverStack(store.products);

  const featured = document.getElementById('featured-products');
  if (featured) {
    featured.innerHTML = store.products.slice(0, 3).map(productCard).join('');
    observeReveals();
  }

  const email = document.getElementById('support-email');
  if (email && store.settings.supportEmail) {
    email.textContent = store.settings.supportEmail;
    email.href = `mailto:${store.settings.supportEmail}`;
  }

  document.querySelectorAll('.contact-card').forEach((card) => {
    if (store.settings.supportPhone && !card.querySelector('.support-phone')) {
      const line = document.createElement('p');
      line.className = 'support-phone';
      line.style.fontSize = '0.85rem';
      line.innerHTML = `Phone / WhatsApp: <strong>${esc(store.settings.supportPhone)}</strong>`;
      card.appendChild(line);
    }
  });
}

boot();
