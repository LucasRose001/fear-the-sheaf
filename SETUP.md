# Fear the Sheaf: Going Live with Payments

The site runs on GitHub Pages like your other sites. Card payments go through **Stripe**.
A tiny **Cloudflare Worker** (free) sits in between so prices can't be changed in someone's browser.

```
Customer's cart  →  Cloudflare Worker (sets real prices)  →  Stripe payment page  →  success.html
```

Do everything in **test mode first**, then switch to live.

---

## 1. The owner makes a Stripe account
1. She signs up at stripe.com with her own email, business name "Fear the Sheaf," and her bank account for payouts.
2. Under **Developers → API keys**, copy the **Secret key** (`sk_test_...` for now).
   Never put this key in the website or on GitHub.
3. Under **Settings → Business → Customer emails**, turn on **Successful payments** so customers get a receipt.
4. Under **Settings → Team & security → Personal notifications**, make sure **Successful payments** is on.
   This is how she gets an email for every order.

## 2. Put the site on GitHub Pages
1. Create a repo (for example `fear-the-sheaf`) on LucasRose001.
2. Upload `index.html`, `success.html` and the `img` folder. The `checkout-worker` folder is optional in the repo; it doesn't run on GitHub Pages.
3. Settings → Pages → deploy from `main`.

## 3. Deploy the checkout worker
From the `checkout-worker` folder on your computer (needs Node.js and a free Cloudflare account):

```bash
npx wrangler login
npx wrangler secret put STRIPE_SECRET_KEY     # paste her sk_test_... key
npx wrangler deploy
```

It prints a URL like `https://fts-checkout.yourname.workers.dev`.

Before deploying, check `wrangler.toml`:
- `SITE_URL` is the site address, no trailing slash (for example `https://lucasrose001.github.io/fear-the-sheaf`, or `https://fearthesheaf.ca` once the domain is connected).
- `ALLOWED_ORIGINS` is just the domain part (for example `https://lucasrose001.github.io`). Add more, comma-separated, if needed.

## 4. Connect the site to the worker
In `index.html`, find `CHECKOUT_URL` near the top of the script and set it to:
```js
const CHECKOUT_URL = "https://fts-checkout.yourname.workers.dev/checkout";
```

## 5. Test it
Add something to the cart, choose a delivery option, and press **Checkout Securely**.
Use the test card `4242 4242 4242 4242`, any future date, and any CVC.
You should land on the "You're Repping the Sheaf" page, and the order should appear in Stripe's dashboard with sizes and delivery method.

## 6. Go live
1. Stripe asks her to finish verifying her business.
2. Copy the **live** secret key (`sk_live_...`) and run `npx wrangler secret put STRIPE_SECRET_KEY` again.
3. Run `npx wrangler deploy`.

---

## Changing products or prices
Prices live in **two places** that must match:
- `index.html`, the `PRODUCTS` list, which controls what shoppers see.
- `checkout-worker/worker.js`, the `CATALOG`, which controls what gets charged. Prices there are in cents, so `3500` = $35.00.

Delivery fees are in `FULFILLMENT` in `worker.js` and in the dropdown text in `index.html`.
After editing the worker, run `npx wrangler deploy`.

## Where she sees orders
In the Stripe dashboard under **Payments**, each payment's **Metadata** shows the items, sizes and delivery method.
The customer's name, email, phone and shipping address are on the payment too.

## Taxes
Prices are currently charged as-is, with no GST/PST added. She should check with her accountant whether she needs to collect tax.
If so, Stripe Tax can be switched on later.

---

## Before launch: fill in the gold blanks
Open `policies.html`. Every **gold-highlighted** blank needs her real info: email, phone, ship and ready times, the pre-order date, the return window and the "last updated" date.
Search the file for `class="fill"`. Replace the text, then delete `class="fill"` so the highlight goes away.
Stripe usually checks for contact info and a refund policy when it verifies her account, so do this first.

If she changes the return window from 14 days or the shipping times, also update the matching numbers in the Google data block in `index.html` (search `merchantReturnDays`).

## The site address appears in a few files
Share previews and Google data need the full site address. Right now it's set to:
`https://lucasrose001.github.io/fear-the-sheaf`, so name the GitHub repo **fear-the-sheaf**.

When a custom domain is connected (for example `fearthesheaf.ca`), find-and-replace that address in:
- `index.html`
- `robots.txt`
- `sitemap.xml`
- `checkout-worker/wrangler.toml` (`SITE_URL` and `ALLOWED_ORIGINS`)

## Check it after going live
- **Share preview:** paste the link into https://developers.facebook.com/tools/debug/. It also refreshes Instagram and Messenger previews if an old one is stuck.
- **Google data:** paste the link into https://search.google.com/test/rich-results. All 4 products should show up.
- **Get listed on Google faster:** add the site in Google Search Console and submit `sitemap.xml`.

---

## Promo codes
The checkout page already has an "Add promotion code" box.
1. In Stripe, go to **Product catalog → Coupons → Create coupon**. For example, 10% off, or $5 off.
2. On that coupon, add a **Promotion code** that customers type in, like `LAUNCH10`.
   You can set an expiry date, a usage limit, or first-order-only.
3. Post the code on Instagram. Nothing on the website needs to change.

## Marking things sold out
Change it in **two places**: `index.html` (the `PRODUCTS` list) and `checkout-worker/worker.js` (the `CATALOG`).
- Whole product: `soldOut: true`
- Certain sizes only: `soldOutSizes: ["XL", "2XL"]`

The site then greys out the product or size and shows a "Sold out" badge.
The worker refuses those items at checkout, so nobody can buy them even with an old cart.
After editing the worker, run `npx wrangler deploy`.

## Size guide numbers
The chart uses typical tee and hoodie measurements. Swap in the measurements from her blank supplier in `index.html`.
Search for `SIZE_CHART`. Each row is `[size, chest width, length]` in inches, and centimetres are calculated automatically.
