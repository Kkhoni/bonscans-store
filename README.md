# Luminae Press — digital ebook storefront

A working ebook store, not a mockup. Three separate products, Razorpay (UPI / QR / cards),
server-side payment verification, webhook handling, signed time-limited PDF delivery and a
private admin dashboard. Exact five-colour identity: Honeydew `#F6FFE9`, Vanilla Custard
`#F2E0A4`, Periwinkle `#CAC5E5`, Amethyst `#A230A4`, Dark Ultramarine `#290087`.

## Run it

Node 20+ is required. This workspace ships a portable copy at `.runtime/node`; if `node` is
not on your PATH use:

```bash
./.runtime/node/node.exe server.js
```

Or install Node LTS normally and run `npm install && npm start`.

- Store: http://127.0.0.1:4173
- Admin: http://127.0.0.1:4173/admin.html
- On first start, if `ADMIN_PASSWORD` is unset, a random admin password is printed in the
  terminal and stored in `data/.admin-password`. Set `ADMIN_PASSWORD` in `.env` to control it.

## What you must connect / provide

| Item | Where | Notes |
| --- | --- | --- |
| 3 ebook PDFs | Admin → Ebooks & files → Upload PDF | Files are stored in `data/pdfs` (private) and never served as static assets. |
| Prices in INR | Admin → Ebooks & files → Price | Products stay unbuyable until both price **and** PDF exist. |
| Covers | Admin → Ebooks & files → Replace cover | Three generated covers are included as placeholders. |
| Razorpay keys | `.env` → `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | Enables UPI, UPI QR, cards, netbanking with automatic verification. |
| Razorpay webhook | `.env` → `RAZORPAY_WEBHOOK_SECRET` + dashboard webhook | URL `https://YOUR-DOMAIN/api/webhooks/razorpay`, events `payment.captured`, `payment.failed`, `order.paid`. |
| Payment QR | Admin → Settings & QR | The attached personal UPI QR is already installed at `public/assets/upi-qr.webp`. |

## Payment flow (as implemented)

1. Buyer opens a product's own checkout (`/checkout.html?product=<slug>`).
2. "Pay securely" creates a server-side order (price is read from the server, never the browser)
   and a matching Razorpay order in paise.
3. Razorpay's window handles UPI / QR / card. This store never sees card details.
4. The browser posts `razorpay_order_id`, `razorpay_payment_id`, `razorpay_signature` to
   `/api/verify`. The server:
   - verifies the HMAC SHA-256 signature with the key secret,
   - fetches the payment from Razorpay,
   - checks `order_id`, currency and that `amount === order.amountPaise`,
   - captures an `authorized` payment, and requires `captured`,
   - then marks the order paid (idempotent — duplicate callbacks cannot double-process).
5. `/api/webhooks/razorpay` verifies `X-Razorpay-Signature` against the raw body and handles
   `payment.captured` / `order.paid` / `payment.failed` for retries and out-of-band payments.
6. Only the purchased product's PDF is unlockable; the success page (`/success.html?token=…`)
   offers **READ EBOOK ONLINE** and **DOWNLOAD EBOOK**.

### Static UPI QR

Your QR is a personal static UPI QR. It is displayed on checkout under **SCAN TO PAY** with the
exact amount, but scanning it cannot be verified programmatically. The store says so plainly
and never unlocks on a screenshot or a claim. If a customer pays to that QR, verify the credit
yourself and use **Admin → Orders → Mark paid** with the transfer reference. Connect Razorpay
for automatic unlocking.

## Ebook security

- PDFs live outside the web root (`data/pdfs`) and cannot be requested by URL.
- `GET /api/file/:orderId/:productId` requires an HMAC-signed, expiring token bound to that
  order **and** product; the order must be `paid` and must reference that product.
- Download links expire after `DOWNLOAD_LINK_TTL_SECONDS` (default 1 hour). The confirmation
  page (`/order.html?token=…`) mints fresh ones.
- Admin access uses an HttpOnly, signed, 12-hour cookie and a password compared in constant
  time; login is rate-limited. Admin routes are never linked from the storefront.

## Data

`data/store.json` holds products, orders, settings and the payment log. Back it up together
with `data/pdfs` and `public/uploads`. Deleting `data/store.json` resets the catalogue.

## Deploying

Any Node host works (Render, Railway, Fly, a VPS, cPanel Node apps). Cloudflare
Workers/Pages cannot run this server as-is — it needs a long-lived Node process and a disk.

1. Push the project to GitHub **without** `.env`, `node_modules/`, `.runtime/`, `data/pdfs/`
   or `public/uploads/` (all already in `.gitignore`).
2. Create a Node web service from that repo. Build command: `npm install`. Start command:
   `npm start`. Node 20+.
3. Attach a persistent disk/volume and point the app at it with `DATA_DIR` (for example
   `/var/data`). Everything that must survive a redeploy lives there: the catalogue, orders,
   PDFs and `.session-secret`. Uploaded covers and the UPI QR are written to
   `public/uploads/`, so re-upload them after a deploy that rebuilds the filesystem, or ask
   for them to be moved onto the volume too.
4. Set the environment variables from `.env.example` in the host's dashboard:
   `ADMIN_PASSWORD`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`,
   and `HOST=0.0.0.0` if the host does not set it. Leave `PORT` alone if the host provides one.
5. Add your domain in the host, wait for HTTPS. Admin cookies are `Secure` behind HTTPS, so
   the site must be served over HTTPS in production.
6. In Razorpay → Account & Settings → Webhooks, add `https://your-domain/api/webhooks/razorpay`
   with the same `RAZORPAY_WEBHOOK_SECRET`, events `payment.captured`, `payment.failed`,
   `order.paid`.
7. Open `https://your-domain/admin.html`, sign in, upload the three PDFs, set titles/prices and
   the support email. Run one small live payment to confirm automatic unlock and download.

Back up `DATA_DIR` (catalogue, orders and PDFs) regularly; `store.json` is plain JSON and can be
copied while the app runs.

## Legal/practical notes

- Enable the payment methods you want in the Razorpay dashboard (UPI QR needs UPI enabled).
- Digital-goods refunds are your policy; the store records every order and payment for disputes.
- Prices are inclusive of taxes as displayed; add GST handling if you are registered.
