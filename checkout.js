import { getStore, initChrome, money, params, esc, toast } from './site.js';

let store = null;
let product = null;
let orderState = null;
let busy = false;
let pollTimer = null;

const el = (id) => document.getElementById(id);

function setStatus(kind, text) {
  const pill = el('status-pill');
  const dot = el('status-dot');
  const label = el('status-text');
  if (pill) {
    pill.textContent = kind === 'paid' ? 'Payment confirmed' : kind === 'failed' ? 'Payment failed' : kind === 'verifying' ? 'Verifying…' : 'Awaiting payment';
    pill.className = 'pill ' + (kind === 'paid' ? 'pill--dark' : 'pill--vanilla');
  }
  if (dot) dot.className = 'status-dot' + (kind === 'paid' ? ' status-dot--ok' : kind === 'failed' ? ' status-dot--bad' : '');
  if (label) label.textContent = text;
}

function notice(message, type = '') {
  const host = el('pay-notice');
  if (!host) return;
  host.innerHTML = `<div class="notice ${type ? `notice--${type}` : ''}">${message}</div>`;
}

function fatal(message) {
  const box = el('checkout-error');
  const grid = el('checkout-grid');
  if (box) {
    box.classList.remove('hide');
    box.innerHTML = `<div><strong>Checkout unavailable</strong>${esc(message)}</div>`;
  }
  if (grid) grid.classList.add('hide');
}

function renderProduct() {
  el('summary-cover').src = product.cover;
  el('summary-cover').alt = `Cover of ${product.title}`;
  el('summary-title').textContent = product.title;
  el('summary-desc').textContent = product.description;
  el('summary-item').textContent = product.title;
  el('summary-total').textContent = product.price === null ? '₹ —' : money(product.price);
  el('qr-product').textContent = product.title;
  el('qr-amount').textContent = product.price === null ? '₹ —' : money(product.price);
  el('upi-id').textContent = `UPI ID: ${store.settings.upiId || 'not set'}`;
  const qr = el('upi-qr');
  qr.src = store.settings.upiQr || '/assets/upi-qr.webp';
  qr.alt = `UPI QR code for ${store.settings.storeName || 'the store'} — pay ${product.price === null ? 'the listed amount' : money(product.price)}`;
  document.title = `${product.title} — Checkout`;

  const payLabel = el('pay-label');
  const payButton = el('pay-now');

  if (!product.available) {
    payButton.disabled = true;
    payLabel.textContent = 'Not available yet';
    const reason = !product.hasPdf
      ? 'The PDF file for this ebook has not been uploaded yet, so it cannot be sold. Please check back soon.'
      : 'The price for this ebook has not been set yet, so checkout is closed. Please check back soon.';
    notice(`<div><strong>This ebook isn’t on sale yet</strong>${esc(reason)}</div>`, 'error');
    setStatus('', 'Checkout closed.');
    setStatus('failed', 'This ebook cannot be purchased yet.');
    return;
  }

  payLabel.textContent = store.payments.razorpayConfigured
    ? `Pay ${money(product.price)} securely`
    : `Start UPI payment · ${money(product.price)}`;

  if (!store.payments.razorpayConfigured) {
    el('gateway-copy').textContent = 'Automatic gateway verification is not connected yet. Use the UPI QR above, then send your order reference to support — the store verifies the transfer and unlocks your ebook manually.';
    notice(`<div><strong>Automatic verification is not connected</strong>Razorpay keys have not been added to this store yet, so the QR cannot be confirmed automatically. You can still pay by UPI, then contact support with your order reference for manual verification and unlocking.</div>`);
  }
}

function loadRazorpay() {
  if (typeof window.Razorpay === 'function') return Promise.resolve(true);
  return new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve(typeof window.Razorpay === 'function');
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
}

async function createOrder() {
  const payload = {
    productId: product.id,
    name: el('buyer-name')?.value?.trim() || '',
    email: el('buyer-email')?.value?.trim() || '',
    phone: el('buyer-phone')?.value?.trim() || ''
  };
  const res = await fetch('/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Could not start checkout.');
  return data;
}

function startPolling() {
  if (pollTimer || !orderState) return;
  pollTimer = setInterval(async () => {
    try {
      const res = await fetch(`/api/order/${encodeURIComponent(orderState.accessToken)}/status`, { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      if (data.status === 'paid') {
        clearInterval(pollTimer);
        pollTimer = null;
        setStatus('paid', 'Payment confirmed. Unlocking your ebook…');
        setTimeout(() => location.replace(`/success.html?token=${encodeURIComponent(orderState.accessToken)}`), 600);
      }
    } catch { /* keep polling quietly */ }
  }, 6000);
}

async function verifyPayment(response) {
  setStatus('verifying', 'Verifying the payment with the gateway…');
  try {
    const res = await fetch('/api/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accessToken: orderState.accessToken,
        razorpay_order_id: response.razorpay_order_id,
        razorpay_payment_id: response.razorpay_payment_id,
        razorpay_signature: response.razorpay_signature
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      throw new Error(data.error || 'The payment could not be verified.');
    }
    setStatus('paid', 'Payment verified. Opening your ebook…');
    toast('Payment verified');
    setTimeout(() => location.replace(data.redirect), 500);
  } catch (error) {
    setStatus('failed', 'Verification failed — no ebook unlocked.');
    notice(`<div><strong>We could not confirm this payment</strong>${esc(error.message)} If money was deducted, contact support with your order reference and we’ll resolve it.</div>`, 'error');
    busy = false;
    el('pay-now').disabled = false;
    el('pay-label').textContent = `Retry ${money(product.price)} payment`;
  }
}

async function openGateway(data) {
  const loaded = await loadRazorpay();
  if (!loaded) {
    setStatus('failed', 'Could not load the secure payment window.');
    notice('<div><strong>The payment window did not load</strong>Check your connection and try again — nothing has been charged.</div>', 'error');
    busy = false;
    el('pay-now').disabled = false;
    return;
  }

  const rzp = new window.Razorpay({
    key: data.keyId,
    order_id: data.razorpayOrderId,
    amount: data.amountPaise,
    currency: data.currency,
    name: store.settings.storeName || 'Luminae Press',
    description: product.title,
    image: `${location.origin}${product.cover}`,
    prefill: {
      name: el('buyer-name')?.value?.trim() || '',
      email: el('buyer-email')?.value?.trim() || '',
      contact: el('buyer-phone')?.value?.trim() || ''
    },
    notes: { publicId: data.order.publicId, productId: product.id },
    theme: { color: '#A230A4' },
    modal: {
      ondismiss: () => {
        busy = false;
        el('pay-now').disabled = false;
        el('pay-label').textContent = `Pay ${money(product.price)} securely`;
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
        setStatus('', 'Payment window closed. No charge confirmed yet.');
        notice('<div><strong>Payment not completed</strong>You closed the gateway window. Nothing was charged. Your ebook stays locked until a verified payment is received.</div>');
      }
    },
    handler: (response) => verifyPayment(response)
  });

  rzp.on('payment.failed', (response) => {
    const message = response?.error?.description || 'The payment failed at the gateway.';
    setStatus('failed', 'Payment failed — no ebook unlocked.');
    notice(`<div><strong>Payment failed</strong>${esc(message)} If money was deducted, it is usually reversed automatically. Contact support with your order reference if not.</div>`, 'error');
    busy = false;
    el('pay-now').disabled = false;
    el('pay-label').textContent = `Try again · ${money(product.price)}`;
  });

  rzp.open();
  setStatus('verifying', 'Waiting for the gateway to confirm your payment…');
  notice('<div><strong>Complete the payment in the secure window</strong>This page unlocks your ebook automatically as soon as the gateway reports the payment.</div>');
  startPolling();
}

async function startPayment() {
  if (busy || !product?.available) return;
  busy = true;
  const button = el('pay-now');
  button.disabled = true;
  el('pay-label').innerHTML = '<span class="spinner" aria-hidden="true"></span>';

  try {
    orderState = await createOrder();
    notice('');
    if (orderState.configured) {
      await openGateway(orderState);
    } else {
      const ref = orderState.order.publicId;
      const body = encodeURIComponent(`Hello, I paid ${money(orderState.amount)} by UPI for "${product.title}". Order reference: ${ref}. Attaching my payment proof.`);
      el('pay-label').textContent = 'Open support to finish';
      button.disabled = false;
      busy = false;
      setStatus('', `Order ${ref} created — awaiting manual verification.`);
      notice(`<div><strong>Order ${esc(ref)} is reserved for you</strong>
        Pay ${money(orderState.amount)} using the UPI QR above (UPI ID: ${esc(store.settings.upiId || '—')}), then email your reference and payment proof to
        <a class="link-quiet" href="mailto:${esc(store.settings.supportEmail)}?subject=${encodeURIComponent('UPI payment verification ' + ref)}&body=${body}">${esc(store.settings.supportEmail)}</a>.
        The store will verify the transfer and unlock this ebook for you. Automatic unlocking begins as soon as Razorpay is connected.</div>`);
      startPolling();
    }
  } catch (error) {
    setStatus('failed', 'Checkout could not start.');
    notice(`<div><strong>Checkout could not start</strong>${esc(error.message)}</div>`, 'error');
    button.disabled = false;
    el('pay-label').textContent = `Pay ${money(product.price)} securely`;
    busy = false;
  }
}

async function boot() {
  try {
    store = await getStore();
  } catch {
    fatal('The store could not be reached.');
    return;
  }
  initChrome(store, store.settings);

  const slug = params.get('product');
  product = store.products.find((item) => item.slug === slug || item.id === slug);
  if (!product) {
    fatal('We could not find that ebook. Choose one from the collection to continue.');
    return;
  }

  renderProduct();
  el('pay-now')?.addEventListener('click', startPayment);
}

boot();
