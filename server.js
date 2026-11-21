import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');

/* ------------------------------------------------------------------ *
 * Environment (.env loader, no external dependency)
 * ------------------------------------------------------------------ */
function loadEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnv();

/* DATA_DIR lets you keep the catalogue and PDFs on a persistent volume. */
const dataOverride = (process.env.DATA_DIR || '').trim();
const DATA_DIR = dataOverride ? path.resolve(ROOT, dataOverride) : path.join(ROOT, 'data');
const PDF_DIR = path.join(DATA_DIR, 'pdfs');
const TMP_DIR = path.join(DATA_DIR, 'tmp');
const PUBLIC_UPLOAD_DIR = path.join(PUBLIC_DIR, 'uploads');
const STORE_FILE = path.join(DATA_DIR, 'store.json');

for (const dir of [DATA_DIR, PDF_DIR, TMP_DIR, PUBLIC_UPLOAD_DIR, path.join(PUBLIC_UPLOAD_DIR, 'covers')]) {
  fs.mkdirSync(dir, { recursive: true });
}

const env = process.env;
const requestedPort = Number(env.PORT);
const PORT = Number.isFinite(requestedPort) && requestedPort > 0 ? requestedPort : 4173;
const HOST = (env.HOST || '').trim() || '0.0.0.0';
const CURRENCY = 'INR';
const RAZORPAY_KEY_ID = (env.RAZORPAY_KEY_ID || '').trim();
const RAZORPAY_KEY_SECRET = (env.RAZORPAY_KEY_SECRET || '').trim();
const RAZORPAY_WEBHOOK_SECRET = (env.RAZORPAY_WEBHOOK_SECRET || '').trim();
const RAZORPAY_ENABLED = Boolean(RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET);
const DOWNLOAD_TTL = Math.max(300, Number(env.DOWNLOAD_LINK_TTL_SECONDS || 3600));

/* ------------------------------------------------------------------ *
 * Secrets / admin bootstrap
 * ------------------------------------------------------------------ */
function persistRandom(fileName, length = 32) {
  const file = path.join(DATA_DIR, fileName);
  if (fs.existsSync(file)) {
    const value = fs.readFileSync(file, 'utf8').trim();
    if (value) return value;
  }
  const value = crypto.randomBytes(length).toString('hex');
  fs.writeFileSync(file, value + '\n', { mode: 0o600 });
  return value;
}

const SESSION_SECRET = (env.SESSION_SECRET || '').trim() || persistRandom('.session-secret');
let ADMIN_PASSWORD = (env.ADMIN_PASSWORD || '').trim();
let generatedAdminPassword = false;
if (!ADMIN_PASSWORD) {
  ADMIN_PASSWORD = persistRandom('.admin-password', 9).slice(0, 14);
  generatedAdminPassword = true;
}

/* ------------------------------------------------------------------ *
 * Store (JSON persistence, serialized writes)
 * ------------------------------------------------------------------ */
const nowIso = () => new Date().toISOString();
const rid = (bytes = 16) => crypto.randomBytes(bytes).toString('hex');

const DEFAULT_PRODUCTS = [
  {
    id: 'p1',
    slug: 'pinterest',
    title: 'How Anyone Can Make $$$$ on Pinterest',
    subtitle: 'A practical playbook for turning Pinterest traffic into income.',
    description:
      'A focused, beginner-friendly guide to building a Pinterest presence that compounds — boards, pins, keywords, and the habits that turn saved ideas into a real audience.',
    price: null,
    cover: '/assets/covers/pinterest.jpg',
    pdfFile: null,
    pdfOriginalName: null,
    pdfSize: null,
    active: true,
    createdAt: nowIso(),
    updatedAt: nowIso()
  },
  {
    id: 'p2',
    slug: 'amazon-affiliate',
    title: 'Earning with Amazon Affiliate Marketing',
    subtitle: 'Build a commission engine around products people already buy.',
    description:
      'The complete path from first link to first payout: choosing products, writing honest recommendations, tracking what converts, and staying compliant with Amazon’s programme rules.',
    price: null,
    cover: '/assets/covers/amazon.jpg',
    pdfFile: null,
    pdfOriginalName: null,
    pdfSize: null,
    active: true,
    createdAt: nowIso(),
    updatedAt: nowIso()
  },
  {
    id: 'p3',
    slug: 'third-ebook',
    title: '[Add third ebook title]',
    subtitle: 'Your third title goes here — fully editable from the dashboard.',
    description:
      'Upload the PDF, write the description, replace the cover and set the price from the admin dashboard. This slot is already wired into checkout, delivery and reporting.',
    price: null,
    cover: '/assets/covers/third.jpg',
    pdfFile: null,
    pdfOriginalName: null,
    pdfSize: null,
    active: true,
    createdAt: nowIso(),
    updatedAt: nowIso()
  }
];

function defaultStore() {
  return {
    settings: {
      storeName: 'Luminae Press',
      supportEmail: 'support@yourdomain.com',
      supportPhone: '',
      upiId: 'chongthamjane6@okhdfcbank',
      upiQr: '/assets/upi-qr.webp',
      currency: CURRENCY
    },
    products: DEFAULT_PRODUCTS,
    orders: [],
    payments: []
  };
}

function loadStore() {
  try {
    if (!fs.existsSync(STORE_FILE)) return defaultStore();
    const parsed = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
    return {
      settings: { ...defaultStore().settings, ...(parsed.settings || {}) },
      products: Array.isArray(parsed.products) && parsed.products.length ? parsed.products : DEFAULT_PRODUCTS,
      orders: Array.isArray(parsed.orders) ? parsed.orders : [],
      payments: Array.isArray(parsed.payments) ? parsed.payments : []
    };
  } catch (error) {
    console.error('[store] Could not read store.json, starting fresh:', error.message);
    return defaultStore();
  }
}

let store = loadStore();
let writeQueue = Promise.resolve();

function saveStore() {
  const snapshot = JSON.stringify(store, null, 2);
  writeQueue = writeQueue.then(async () => {
    const tmp = STORE_FILE + '.tmp';
    await fsp.writeFile(tmp, snapshot, 'utf8');
    await fsp.rename(tmp, STORE_FILE);
  }).catch((error) => {
    console.error('[store] write failed:', error.message);
  });
  return writeQueue;
}
saveStore();

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */
const safeEqual = (a, b) => {
  const left = Buffer.from(String(a ?? ''));
  const right = Buffer.from(String(b ?? ''));
  if (left.length !== right.length || left.length === 0) return false;
  return crypto.timingSafeEqual(left, right);
};

const sign = (value) => crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('hex');
const signWith = (value, secret) => crypto.createHmac('sha256', secret).update(value).digest('hex');

function fileToken(orderId, productId) {
  const exp = Math.floor(Date.now() / 1000) + DOWNLOAD_TTL;
  const signature = sign(`file:${orderId}:${productId}:${exp}`).slice(0, 40);
  return { exp, signature };
}

function verifyFileToken(orderId, productId, exp, signature) {
  if (!exp || Number(exp) < Math.floor(Date.now() / 1000)) return false;
  if (Math.abs(Number(exp) - Math.floor(Date.now() / 1000)) > DOWNLOAD_TTL + 60) return false;
  return safeEqual(sign(`file:${orderId}:${productId}:${exp}`).slice(0, 40), signature);
}

const publicProduct = (product) => ({
  id: product.id,
  slug: product.slug,
  title: product.title,
  subtitle: product.subtitle,
  description: product.description,
  price: product.price === null || product.price === undefined ? null : Number(product.price),
  cover: product.cover,
  active: Boolean(product.active),
  available: Boolean(product.active) && Number(product.price) > 0 && Boolean(product.pdfFile),
  hasPdf: Boolean(product.pdfFile)
});

function publicOrder(order) {
  const product = store.products.find((p) => p.id === order.productId);
  return {
    publicId: order.publicId,
    productId: order.productId,
    productTitle: order.productTitle,
    amount: order.amount,
    currency: order.currency || CURRENCY,
    status: order.status,
    createdAt: order.createdAt,
    paidAt: order.paidAt || null,
    customer: order.customer || {},
    cover: product ? product.cover : null,
    downloadCount: order.downloadCount || 0
  };
}

function rzpConfigured() {
  return RAZORPAY_ENABLED;
}

async function razorpayRequest(endpoint, options = {}) {
  if (!RAZORPAY_ENABLED) throw new Error('Razorpay is not configured');
  const res = await fetch(`https://api.razorpay.com/v1${endpoint}`, {
    ...options,
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64'),
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) {
    const description = data?.error?.description || `Razorpay error (${res.status})`;
    const error = new Error(description);
    error.status = res.status;
    error.data = data;
    throw error;
  }
  return data;
}

function logPayment(entry) {
  const duplicate = entry.gatewayPaymentId
    ? store.payments.some((p) => p.gatewayPaymentId === entry.gatewayPaymentId && p.status === entry.status)
    : false;
  if (duplicate) return;
  store.payments.unshift({
    id: 'pay_' + rid(8),
    at: nowIso(),
    source: 'system',
    ...entry
  });
  if (store.payments.length > 5000) store.payments.length = 5000;
}

function markPaid(order, details = {}) {
  if (!order) return { changed: false, reason: 'order-not-found' };
  if (order.status === 'paid') return { changed: false, reason: 'already-paid' };

  const paidAmount = details.amountPaise == null ? order.amountPaise : Number(details.amountPaise);
  if (Number.isFinite(paidAmount) && paidAmount !== order.amountPaise) {
    logPayment({
      orderId: order.id,
      publicId: order.publicId,
      gatewayPaymentId: details.gatewayPaymentId || null,
      event: details.event || 'amount_mismatch',
      status: 'failed',
      amountPaise: paidAmount,
      expectedPaise: order.amountPaise,
      method: details.method || null,
      source: details.source || 'system',
      note: 'Paid amount does not match the order amount. Ebook not unlocked.'
    });
    saveStore();
    return { changed: false, reason: 'amount-mismatch' };
  }

  order.status = 'paid';
  order.paidAt = nowIso();
  order.razorpayPaymentId = details.gatewayPaymentId || order.razorpayPaymentId || null;
  order.paymentMethod = details.method || order.paymentMethod || null;
  order.paymentSource = details.source || 'gateway';
  logPayment({
    orderId: order.id,
    publicId: order.publicId,
    gatewayPaymentId: order.razorpayPaymentId,
    event: details.event || 'payment.captured',
    status: 'paid',
    amountPaise: order.amountPaise,
    method: order.paymentMethod,
    source: details.source || 'system',
    note: details.note || null
  });
  saveStore();
  return { changed: true };
}

/* ------------------------------------------------------------------ *
 * App
 * ------------------------------------------------------------------ */
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});

/* Webhook needs the raw body for signature verification. */
app.post('/api/webhooks/razorpay', express.raw({ type: '*/*', limit: '2mb' }), (req, res) => {
  if (!RAZORPAY_WEBHOOK_SECRET) {
    return res.status(503).json({ ok: false, error: 'Webhook secret is not configured.' });
  }
  const signature = req.get('X-Razorpay-Signature') || '';
  const raw = req.body instanceof Buffer ? req.body : Buffer.from(req.body || '');
  const expected = signWith(raw, RAZORPAY_WEBHOOK_SECRET);
  if (!safeEqual(signature, expected)) {
    console.warn('[webhook] invalid signature');
    return res.status(400).json({ ok: false, error: 'Invalid webhook signature.' });
  }

  let payload;
  try { payload = JSON.parse(raw.toString('utf8')); } catch { return res.status(400).json({ ok: false, error: 'Invalid JSON.' }); }

  try {
    const event = payload.event || 'unknown';
    const payment = payload.payload?.payment?.entity;
    const gatewayOrder = payload.payload?.order?.entity;

    if (payment) {
      const publicId = payment.notes?.publicId;
      let order = publicId
        ? store.orders.find((o) => o.publicId === publicId)
        : store.orders.find((o) => o.razorpayOrderId && o.razorpayOrderId === payment.order_id);
      if (!order && gatewayOrder?.receipt) {
        order = store.orders.find((o) => o.id === gatewayOrder.receipt);
      }

      if (!order) {
        logPayment({
          gatewayPaymentId: payment.id,
          event,
          status: 'failed',
          amountPaise: payment.amount,
          method: payment.method,
          source: 'webhook',
          note: 'Payment received but no matching order was found. Review this transaction manually.'
        });
        saveStore();
      } else if (event === 'payment.captured' || event === 'order.paid') {
        if (!gatewayOrder || payment.currency === CURRENCY) {
          markPaid(order, {
            gatewayPaymentId: payment.id,
            amountPaise: payment.amount,
            method: payment.method,
            event,
            source: 'webhook'
          });
        }
      } else if (event === 'payment.failed') {
        if (order.status !== 'paid') {
          order.status = 'failed';
          order.failureReason = payment.error_description || payment.error_code || 'Payment failed';
        }
        logPayment({
          orderId: order.id,
          publicId: order.publicId,
          gatewayPaymentId: payment.id,
          event,
          status: 'failed',
          amountPaise: payment.amount,
          method: payment.method,
          source: 'webhook',
          note: payment.error_description || payment.error_reason || 'Payment failed at the gateway.'
        });
        saveStore();
      } else {
        logPayment({
          orderId: order.id,
          publicId: order.publicId,
          gatewayPaymentId: payment.id,
          event,
          status: 'failed',
          amountPaise: payment.amount,
          method: payment.method,
          source: 'webhook',
          note: 'Unhandled event recorded for audit.'
        });
        saveStore();
      }
    }
    res.json({ ok: true });
  } catch (error) {
    console.error('[webhook] handler error:', error);
    res.status(500).json({ ok: false });
  }
});

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */
app.get('/api/health', (req, res) => {
  res.json({ ok: true, razorpayConfigured: rzpConfigured(), webhookConfigured: Boolean(RAZORPAY_WEBHOOK_SECRET) });
});

app.get('/api/store', (req, res) => {
  res.json({
    settings: {
      storeName: store.settings.storeName,
      supportEmail: store.settings.supportEmail,
      supportPhone: store.settings.supportPhone,
      upiId: store.settings.upiId,
      upiQr: store.settings.upiQr,
      currency: CURRENCY
    },
    products: store.products.map(publicProduct),
    payments: {
      razorpayConfigured: rzpConfigured(),
      keyId: rzpConfigured() ? RAZORPAY_KEY_ID : null,
      webhookConfigured: Boolean(RAZORPAY_WEBHOOK_SECRET)
    }
  });
});

const orderLimiter = new Map();
function allowOrder(ip) {
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;
  const entry = orderLimiter.get(ip) || { count: 0, reset: now + windowMs };
  if (now > entry.reset) { entry.count = 0; entry.reset = now + windowMs; }
  entry.count += 1;
  orderLimiter.set(ip, entry);
  return entry.count <= 30;
}

app.post('/api/orders', async (req, res) => {
  const ip = req.ip || 'unknown';
  if (!allowOrder(ip)) {
    return res.status(429).json({ ok: false, error: 'Too many checkout attempts. Please try again later.' });
  }

  const { productId, name = '', email = '', phone = '' } = req.body || {};
  const product = store.products.find((p) => p.id === productId || p.slug === productId);
  if (!product) return res.status(404).json({ ok: false, error: 'That ebook could not be found.' });
  if (!product.active) return res.status(409).json({ ok: false, error: 'This ebook is not available right now.' });
  if (!(Number(product.price) > 0)) {
    return res.status(409).json({ ok: false, error: 'Pricing for this ebook has not been set yet. Please check back shortly.' });
  }
  if (!product.pdfFile || !fs.existsSync(path.join(PDF_DIR, product.pdfFile))) {
    return res.status(409).json({ ok: false, error: 'The ebook file has not been uploaded yet. Please contact support.' });
  }

  const amount = Math.round(Number(product.price) * 100) / 100;
  const amountPaise = Math.round(amount * 100);
  const order = {
    id: 'ord_' + rid(9),
    publicId: 'LMN-' + crypto.randomBytes(3).toString('hex').toUpperCase(),
    accessToken: rid(32),
    productId: product.id,
    productTitle: product.title,
    amount,
    amountPaise,
    currency: CURRENCY,
    status: 'created',
    createdAt: nowIso(),
    customer: {
      name: String(name).slice(0, 80),
      email: String(email).slice(0, 160),
      phone: String(phone).slice(0, 20)
    }
  };

  if (rzpConfigured()) {
    try {
      const gatewayOrder = await razorpayRequest('/orders', {
        method: 'POST',
        body: JSON.stringify({
          amount: amountPaise,
          currency: CURRENCY,
          receipt: order.id,
          notes: { publicId: order.publicId, productId: product.id, productTitle: product.title.slice(0, 100) }
        })
      });
      order.razorpayOrderId = gatewayOrder.id;
    } catch (error) {
      console.error('[orders] Razorpay order failed:', error.message);
      return res.status(502).json({
        ok: false,
        error: 'We could not start the payment with the gateway. Please try again in a moment.'
      });
    }
  }

  store.orders.unshift(order);
  if (store.orders.length > 5000) store.orders.length = 5000;
  saveStore();

  res.json({
    ok: true,
    accessToken: order.accessToken,
    configured: rzpConfigured(),
    keyId: rzpConfigured() ? RAZORPAY_KEY_ID : null,
    razorpayOrderId: order.razorpayOrderId || null,
    amount: order.amount,
    amountPaise,
    currency: CURRENCY,
    order: publicOrder(order),
    product: publicProduct(product),
    upi: { qr: store.settings.upiQr, upiId: store.settings.upiId }
  });
});

function findOrderByToken(token) {
  if (!token || typeof token !== 'string') return null;
  return store.orders.find((o) => o.accessToken && safeEqual(o.accessToken, token)) || null;
}

app.get('/api/order/:token', (req, res) => {
  const order = findOrderByToken(req.params.token);
  if (!order) return res.status(404).json({ ok: false, error: 'This purchase link is not valid.' });
  const product = store.products.find((p) => p.id === order.productId);
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    ok: true,
    order: publicOrder(order),
    product: product ? publicProduct(product) : null,
    unlocked: order.status === 'paid'
  });
});

app.get('/api/order/:token/status', (req, res) => {
  const order = findOrderByToken(req.params.token);
  if (!order) return res.status(404).json({ ok: false, error: 'This purchase link is not valid.' });
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true, status: order.status, paidAt: order.paidAt || null });
});

function buildAccessPayload(order) {
  const product = store.products.find((p) => p.id === order.productId);
  const { exp, signature } = fileToken(order.id, order.productId);
  const query = `exp=${exp}&sig=${signature}`;
  const base = `/api/file/${order.id}/${order.productId}`;
  return {
    expiresAt: new Date(exp * 1000).toISOString(),
    expiresInSeconds: DOWNLOAD_TTL,
    readerUrl: `${base}?${query}&mode=read`,
    downloadUrl: `${base}?${query}&mode=download`,
    fileName: product?.pdfOriginalName || `${(product?.title || 'ebook').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.pdf`
  };
}

app.get('/api/access/:token', (req, res) => {
  const order = findOrderByToken(req.params.token);
  if (!order) return res.status(404).json({ ok: false, error: 'This purchase link is not valid.' });
  if (order.status !== 'paid') {
    return res.status(403).json({ ok: false, error: 'This order has not been paid yet.', status: order.status });
  }
  const product = store.products.find((p) => p.id === order.productId);
  if (!product?.pdfFile) {
    return res.status(409).json({ ok: false, error: 'The ebook file is being prepared. Please contact support.' });
  }
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    ok: true,
    order: publicOrder(order),
    product: publicProduct(product),
    links: buildAccessPayload(order)
  });
});

/* Secure, time-limited PDF delivery. */
app.get('/api/file/:orderId/:productId', (req, res) => {
  const { orderId, productId } = req.params;
  const { exp, sig, mode } = req.query;
  const order = store.orders.find((o) => o.id === orderId);
  res.setHeader('Cache-Control', 'no-store, private');
  if (!order || order.status !== 'paid' || order.productId !== productId) {
    return res.status(403).send('This ebook is not available with that link.');
  }
  if (!verifyFileToken(orderId, productId, exp, sig)) {
    return res.status(403).send('This link has expired. Reopen your purchase page to generate a fresh one.');
  }
  const product = store.products.find((p) => p.id === productId);
  if (!product?.pdfFile) return res.status(404).send('The ebook file is missing.');

  const absolute = path.resolve(PDF_DIR, product.pdfFile);
  if (!absolute.startsWith(path.resolve(PDF_DIR) + path.sep) || !fs.existsSync(absolute)) {
    return res.status(404).send('The ebook file is missing.');
  }

  const downloadName = (product.pdfOriginalName || `${product.slug || 'ebook'}.pdf`).replace(/[^\w.\-() ]+/g, '_');
  const disposition = mode === 'read' ? 'inline' : 'attachment';
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${disposition}; filename="${downloadName}"`);
  res.setHeader('Cache-Control', 'private, no-store');

  if (mode !== 'read' && !req.query.preview) {
    order.downloadCount = (order.downloadCount || 0) + 1;
    order.lastDownloadAt = nowIso();
    saveStore();
  }

  res.sendFile(absolute, { headers: { 'Content-Type': 'application/pdf' } }, (error) => {
    if (error && !res.headersSent) {
      res.status(error.status || 500).send('Could not deliver the file.');
    }
  });
});

/* Server-side payment verification (never trust the browser). */
app.post('/api/verify', async (req, res) => {
  const { accessToken, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
  const order = findOrderByToken(accessToken);
  if (!order) return res.status(404).json({ ok: false, error: 'Order not found.' });

  if (order.status === 'paid') {
    return res.json({ ok: true, status: 'paid', redirect: `/success.html?token=${order.accessToken}` });
  }
  if (!rzpConfigured()) {
    return res.status(503).json({ ok: false, error: 'Payment verification is not configured on this store yet.' });
  }
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ ok: false, error: 'Missing payment details.' });
  }
  if (order.razorpayOrderId && !safeEqual(order.razorpayOrderId, razorpay_order_id)) {
    return res.status(400).json({ ok: false, error: 'This payment does not belong to this order.' });
  }

  const expectedSignature = signWith(`${razorpay_order_id}|${razorpay_payment_id}`, RAZORPAY_KEY_SECRET);
  if (!safeEqual(expectedSignature, razorpay_signature)) {
    logPayment({
      orderId: order.id,
      publicId: order.publicId,
      gatewayPaymentId: razorpay_payment_id,
      event: 'signature_invalid',
      status: 'failed',
      amountPaise: null,
      source: 'checkout',
      note: 'Gateway signature did not match. Nothing was unlocked.'
    });
    saveStore();
    return res.status(400).json({ ok: false, error: 'Payment could not be verified. No ebook was unlocked.' });
  }

  let payment;
  try {
    payment = await razorpayRequest(`/payments/${encodeURIComponent(razorpay_payment_id)}`);
  } catch (error) {
    console.error('[verify] could not fetch payment:', error.message);
    return res.status(502).json({ ok: false, error: 'The gateway is not responding. Your payment is safe — retry in a moment.' });
  }

  if (payment.order_id !== razorpay_order_id) {
    return res.status(400).json({ ok: false, error: 'This payment does not belong to this order.' });
  }
  if (payment.amount !== order.amountPaise || payment.currency !== CURRENCY) {
    logPayment({
      orderId: order.id,
      publicId: order.publicId,
      gatewayPaymentId: payment.id,
      event: 'amount_mismatch',
      status: 'failed',
      amountPaise: payment.amount,
      expectedPaise: order.amountPaise,
      method: payment.method,
      source: 'checkout',
      note: 'Paid amount did not match the ebook price. Nothing was unlocked.'
    });
    saveStore();
    return res.status(400).json({ ok: false, error: 'The paid amount does not match this ebook’s price. Nothing was unlocked.' });
  }

  if (payment.status === 'authorized') {
    try {
      payment = await razorpayRequest(`/payments/${encodeURIComponent(payment.id)}/capture`, {
        method: 'POST',
        body: JSON.stringify({ amount: order.amountPaise, currency: CURRENCY })
      });
    } catch (error) {
      console.error('[verify] capture failed:', error.message);
    }
  }

  if (payment.status !== 'captured') {
    logPayment({
      orderId: order.id,
      publicId: order.publicId,
      gatewayPaymentId: payment.id,
      event: 'payment.' + payment.status,
      status: 'failed',
      amountPaise: payment.amount,
      method: payment.method,
      source: 'checkout',
      note: `Payment status is ${payment.status}. Nothing was unlocked.`
    });
    saveStore();
    return res.status(409).json({
      ok: false,
      error: `The gateway reports this payment as “${payment.status}”. Your ebook stays locked until it is captured.`
    });
  }

  const result = markPaid(order, {
    gatewayPaymentId: payment.id,
    amountPaise: payment.amount,
    method: payment.method,
    event: 'payment.captured',
    source: 'checkout'
  });

  if (result.reason === 'amount-mismatch') {
    return res.status(400).json({ ok: false, error: 'The paid amount does not match this ebook’s price.' });
  }

  res.json({ ok: true, status: 'paid', redirect: `/success.html?token=${order.accessToken}` });
});

/* ------------------------------------------------------------------ *
 * Admin authentication
 * ------------------------------------------------------------------ */
const adminLimiter = new Map();

function adminCookieValue() {
  const exp = Date.now() + 1000 * 60 * 60 * 12;
  const payload = `${exp}`;
  return `${payload}.${sign(`admin:${payload}`)}`;
}

function isAdmin(req) {
  const raw = req.headers.cookie || '';
  const match = raw.split(/;\s*/).find((part) => part.startsWith('admin_session='));
  if (!match) return false;
  const value = decodeURIComponent(match.slice('admin_session='.length));
  const [payload, signature] = value.split('.');
  if (!payload || !signature) return false;
  if (Number(payload) < Date.now()) return false;
  if (!safeEqual(sign(`admin:${payload}`), signature)) return false;
  return true;
}

function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: 'Administrator sign-in required.' });
  next();
}

app.post('/api/admin/login', (req, res) => {
  const ip = req.ip || 'unknown';
  const now = Date.now();
  const entry = adminLimiter.get(ip) || { count: 0, reset: now + 15 * 60 * 1000 };
  if (now > entry.reset) { entry.count = 0; entry.reset = now + 15 * 60 * 1000; }
  entry.count += 1;
  adminLimiter.set(ip, entry);
  if (entry.count > 12) return res.status(429).json({ ok: false, error: 'Too many attempts. Try again in 15 minutes.' });

  const { password = '' } = req.body || {};
  if (!safeEqual(password, ADMIN_PASSWORD)) {
    return res.status(401).json({ ok: false, error: 'Incorrect administrator password.' });
  }
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader('Set-Cookie', `admin_session=${encodeURIComponent(adminCookieValue())}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 12}${secure ? '; Secure' : ''}`);
  res.json({ ok: true });
});

app.post('/api/admin/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'admin_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/admin/session', (req, res) => {
  res.json({ ok: true, authenticated: isAdmin(req) });
});

/* ------------------------------------------------------------------ *
 * Admin API
 * ------------------------------------------------------------------ */
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, TMP_DIR),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${rid(6)}`)
  }),
  limits: { fileSize: 120 * 1024 * 1024 }
});

async function removeQuietly(file) {
  if (!file) return;
  try { await fsp.unlink(file); } catch { /* ignore */ }
}

function adminProduct(product) {
  return {
    ...publicProduct(product),
    pdfOriginalName: product.pdfOriginalName || null,
    pdfSize: product.pdfSize || null,
    updatedAt: product.updatedAt
  };
}

app.get('/api/admin/data', requireAdmin, (req, res) => {
  const paidOrders = store.orders.filter((o) => o.status === 'paid');
  const totalRevenue = paidOrders.reduce((sum, o) => sum + Number(o.amount || 0), 0);
  const byProduct = store.products.map((product) => {
    const sales = paidOrders.filter((o) => o.productId === product.id);
    return {
      id: product.id,
      title: product.title,
      price: product.price,
      sales: sales.length,
      revenue: sales.reduce((sum, o) => sum + Number(o.amount || 0), 0)
    };
  });

  res.setHeader('Cache-Control', 'no-store');
  res.json({
    ok: true,
    products: store.products.map(adminProduct),
    orders: store.orders.slice(0, 300).map((order) => ({
      ...order,
      accessUrl: `/order.html?token=${order.accessToken}`
    })),
    payments: store.payments.slice(0, 300),
    settings: store.settings,
    stats: {
      totalRevenue,
      paidOrders: paidOrders.length,
      failedPayments: store.payments.filter((p) => p.status === 'failed').length,
      pendingOrders: store.orders.filter((o) => o.status === 'created').length,
      averageOrder: paidOrders.length ? totalRevenue / paidOrders.length : 0,
      byProduct
    },
    paymentsConfigured: {
      razorpay: rzpConfigured(),
      webhook: Boolean(RAZORPAY_WEBHOOK_SECRET),
      keyId: rzpConfigured() ? RAZORPAY_KEY_ID : null
    }
  });
});

app.post('/api/admin/products', requireAdmin, (req, res) => {
  const product = {
    id: 'p_' + rid(5),
    slug: 'ebook-' + rid(3),
    title: 'New ebook',
    subtitle: '',
    description: '',
    price: null,
    cover: '/assets/covers/third.jpg',
    pdfFile: null,
    pdfOriginalName: null,
    pdfSize: null,
    active: false,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  store.products.push(product);
  saveStore();
  res.json({ ok: true, product: adminProduct(product) });
});

app.patch('/api/admin/products/:id', requireAdmin, (req, res) => {
  const product = store.products.find((p) => p.id === req.params.id);
  if (!product) return res.status(404).json({ ok: false, error: 'Product not found.' });
  const body = req.body || {};

  if (typeof body.title === 'string') product.title = body.title.trim().slice(0, 140);
  if (typeof body.subtitle === 'string') product.subtitle = body.subtitle.trim().slice(0, 200);
  if (typeof body.description === 'string') product.description = body.description.trim().slice(0, 4000);
  if (typeof body.active === 'boolean') product.active = body.active;

  if ('price' in body) {
    if (body.price === null || body.price === '') {
      product.price = null;
    } else {
      const value = Number(body.price);
      if (!Number.isFinite(value) || value < 0 || value > 1000000) {
        return res.status(400).json({ ok: false, error: 'Enter a valid price in INR.' });
      }
      product.price = Math.round(value * 100) / 100;
    }
  }

  product.updatedAt = nowIso();
  saveStore();
  res.json({ ok: true, product: adminProduct(product) });
});

app.delete('/api/admin/products/:id', requireAdmin, async (req, res) => {
  const index = store.products.findIndex((p) => p.id === req.params.id);
  if (index === -1) return res.status(404).json({ ok: false, error: 'Product not found.' });
  const product = store.products[index];
  if (store.orders.some((o) => o.productId === product.id && o.status === 'paid')) {
    return res.status(409).json({
      ok: false,
      error: 'This ebook has paid orders. Deactivate it instead so buyers keep access to their files.'
    });
  }
  if (product.pdfFile) await removeQuietly(path.join(PDF_DIR, product.pdfFile));
  store.products.splice(index, 1);
  saveStore();
  res.json({ ok: true });
});

app.post('/api/admin/products/:id/cover', requireAdmin, upload.single('cover'), async (req, res) => {
  const product = store.products.find((p) => p.id === req.params.id);
  if (!product || !req.file) {
    await removeQuietly(req.file?.path);
    return res.status(400).json({ ok: false, error: 'Cover upload failed.' });
  }
  const allowed = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
  const ext = allowed[req.file.mimetype];
  if (!ext) {
    await removeQuietly(req.file.path);
    return res.status(400).json({ ok: false, error: 'Cover must be a JPG, PNG or WebP image.' });
  }
  const fileName = `cover-${product.id}-${Date.now()}${ext}`;
  await fsp.rename(req.file.path, path.join(PUBLIC_UPLOAD_DIR, 'covers', fileName));
  product.cover = `/uploads/covers/${fileName}`;
  product.updatedAt = nowIso();
  saveStore();
  res.json({ ok: true, product: adminProduct(product) });
});

app.post('/api/admin/products/:id/pdf', requireAdmin, upload.single('pdf'), async (req, res) => {
  const product = store.products.find((p) => p.id === req.params.id);
  if (!product) {
    await removeQuietly(req.file?.path);
    return res.status(404).json({ ok: false, error: 'Product not found.' });
  }
  if (!req.file) return res.status(400).json({ ok: false, error: 'No PDF received.' });

  try {
    const handle = await fsp.open(req.file.path, 'r');
    const buffer = Buffer.alloc(1024);
    await handle.read(buffer, 0, 1024, 0);
    await handle.close();
    if (!buffer.includes('%PDF-')) {
      await removeQuietly(req.file.path);
      return res.status(400).json({ ok: false, error: 'That file is not a valid PDF.' });
    }
  } catch {
    await removeQuietly(req.file.path);
    return res.status(400).json({ ok: false, error: 'Could not read the uploaded file.' });
  }

  const fileName = `${product.id}-${Date.now()}.pdf`;
  await fsp.rename(req.file.path, path.join(PDF_DIR, fileName));
  if (product.pdfFile) await removeQuietly(path.join(PDF_DIR, product.pdfFile));

  product.pdfFile = fileName;
  product.pdfOriginalName = path.basename(req.file.originalname || 'ebook.pdf').replace(/[^\w.\-() ]+/g, '_');
  product.pdfSize = req.file.size;
  product.updatedAt = nowIso();
  saveStore();
  res.json({ ok: true, product: adminProduct(product) });
});

app.delete('/api/admin/products/:id/pdf', requireAdmin, async (req, res) => {
  const product = store.products.find((p) => p.id === req.params.id);
  if (!product) return res.status(404).json({ ok: false, error: 'Product not found.' });
  if (product.pdfFile) await removeQuietly(path.join(PDF_DIR, product.pdfFile));
  product.pdfFile = null;
  product.pdfOriginalName = null;
  product.pdfSize = null;
  product.updatedAt = nowIso();
  saveStore();
  res.json({ ok: true, product: adminProduct(product) });
});

app.post('/api/admin/qr', requireAdmin, upload.single('qr'), async (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: 'No image received.' });
  const allowed = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
  const ext = allowed[req.file.mimetype];
  if (!ext) {
    await removeQuietly(req.file.path);
    return res.status(400).json({ ok: false, error: 'QR image must be a JPG, PNG or WebP image.' });
  }
  const fileName = `upi-qr-${Date.now()}${ext}`;
  await fsp.rename(req.file.path, path.join(PUBLIC_UPLOAD_DIR, fileName));
  store.settings.upiQr = `/uploads/${fileName}`;
  saveStore();
  res.json({ ok: true, settings: store.settings });
});

app.patch('/api/admin/settings', requireAdmin, (req, res) => {
  const body = req.body || {};
  if (typeof body.storeName === 'string') store.settings.storeName = body.storeName.trim().slice(0, 80) || 'Luminae Press';
  if (typeof body.supportEmail === 'string') store.settings.supportEmail = body.supportEmail.trim().slice(0, 160);
  if (typeof body.supportPhone === 'string') store.settings.supportPhone = body.supportPhone.trim().slice(0, 40);
  if (typeof body.upiId === 'string') store.settings.upiId = body.upiId.trim().slice(0, 120);
  saveStore();
  res.json({ ok: true, settings: store.settings });
});

app.post('/api/admin/orders/:id/mark-paid', requireAdmin, (req, res) => {
  const order = store.orders.find((o) => o.id === req.params.id || o.publicId === req.params.id);
  if (!order) return res.status(404).json({ ok: false, error: 'Order not found.' });
  const note = String(req.body?.note || '').slice(0, 300);
  if (!note) {
    return res.status(400).json({
      ok: false,
      error: 'Add a reference for the bank/UPI transfer you verified before unlocking this order.'
    });
  }
  const result = markPaid(order, { source: 'manual-admin', event: 'manual.verified', note });
  if (!result.changed && result.reason !== 'already-paid') {
    return res.status(409).json({ ok: false, error: 'Could not mark this order as paid.' });
  }
  res.json({ ok: true, order: publicOrder(order) });
});

app.post('/api/admin/orders/:id/mark-failed', requireAdmin, (req, res) => {
  const order = store.orders.find((o) => o.id === req.params.id || o.publicId === req.params.id);
  if (!order) return res.status(404).json({ ok: false, error: 'Order not found.' });
  if (order.status === 'paid') {
    return res.status(409).json({ ok: false, error: 'Paid orders cannot be marked as failed.' });
  }
  order.status = 'failed';
  order.failureReason = String(req.body?.note || 'Marked failed by administrator').slice(0, 300);
  logPayment({
    orderId: order.id,
    publicId: order.publicId,
    event: 'manual.failed',
    status: 'failed',
    amountPaise: order.amountPaise,
    source: 'manual-admin',
    note: order.failureReason
  });
  saveStore();
  res.json({ ok: true, order: publicOrder(order) });
});

/* ------------------------------------------------------------------ *
 * Static site
 * ------------------------------------------------------------------ */
app.use(express.static(PUBLIC_DIR, { extensions: ['html'], maxAge: '1h', setHeaders: (res, filePath) => {
  if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
} }));

app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ ok: false, error: 'Not found.' });
  res.status(404).sendFile(path.join(PUBLIC_DIR, '404.html'));
});

app.use((error, req, res, next) => {
  if (error?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ ok: false, error: 'That file is too large (120 MB maximum).' });
  }
  console.error('[server]', error);
  if (res.headersSent) return next(error);
  res.status(500).json({ ok: false, error: 'Something went wrong on our side.' });
});

app.listen(PORT, HOST, () => {
  console.log('');
  console.log('  Luminae Press storefront');
  console.log(`  Store:   http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`  Admin:   http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}/admin.html`);
  console.log(`  Payments: ${rzpConfigured() ? 'Razorpay configured' : 'Razorpay NOT configured (automatic verification disabled)'}`);
  if (generatedAdminPassword) {
    console.log(`  Admin password: ${ADMIN_PASSWORD}  (saved in data/.admin-password — set ADMIN_PASSWORD in .env to change)`);
  }
  if (!rzpConfigured()) {
    console.log('  Add RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET to .env to enable automatic unlocking.');
  }
  console.log('');
});
