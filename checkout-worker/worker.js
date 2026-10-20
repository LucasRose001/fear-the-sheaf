/**
 * Fear the Sheaf: Stripe Checkout worker (Cloudflare Workers, free plan)
 *
 * The website sends:  { items: [{id, size, qty}], fulfillment: "pickup" | "local" | "ship" }
 * This worker looks up the REAL prices below (so nobody can change prices in their browser),
 * creates a Stripe Checkout Session, and returns { url } for the site to redirect to.
 *
 * Secrets / variables (set in Cloudflare, never in this file):
 *   STRIPE_SECRET_KEY  : secret,  sk_test_... while testing, sk_live_... when going live
 *   SITE_URL           : variable, e.g. https://fearthesheaf.ca   (no trailing slash)
 *   ALLOWED_ORIGINS    : variable, comma list, e.g. https://fearthesheaf.ca,https://lucasrose001.github.io
 */

// ====== KEEP IN SYNC WITH THE PRODUCTS LIST IN index.html ======
// price is in CENTS (3500 = $35.00 CAD)
// Sold out: set soldOut: true for the whole product, or list sizes in soldOutSizes, e.g. ["2XL"]
export const CATALOG = {
  tee:    { name: "Signature Sheaf Tee",  price: 3500, sizes: ["S", "M", "L", "XL", "2XL"], soldOut: false, soldOutSizes: [] },
  hoodie: { name: "Prairie Built Hoodie", price: 6500, sizes: ["S", "M", "L", "XL", "2XL"], preorder: true, soldOut: false, soldOutSizes: [] },
  cap:    { name: "Sheaf Trucker Cap",    price: 3200, sizes: ["Wordmark", "Sheaf Only"], preorder: true, soldOut: false, soldOutSizes: [] },
  gold:   { name: "Gold Field Tee",       price: 3500, sizes: ["S", "M", "L", "XL", "2XL"], soldOut: false, soldOutSizes: [] },
};

const FULFILLMENT = {
  pickup: { label: "Pickup in Martensville",     amount: 0,    needsAddress: false },
  local:  { label: "Saskatoon-area delivery",    amount: 500,  needsAddress: true  },
  ship:   { label: "Shipping within Canada",     amount: 1500, needsAddress: true  },
};

const MAX_LINES = 30;
const MAX_QTY = 25;

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = (env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
    const cors = {
      "Access-Control-Allow-Origin": allowed.includes(origin) ? origin : (allowed[0] || ""),
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin",
    };
    const json = (body, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST" || new URL(request.url).pathname !== "/checkout") return json({ error: "Not found" }, 404);
    if (allowed.length && !allowed.includes(origin)) return json({ error: "Origin not allowed" }, 403);
    if (!env.STRIPE_SECRET_KEY || !env.SITE_URL) return json({ error: "Worker not configured" }, 500);

    let body;
    try { body = await request.json(); } catch { return json({ error: "Bad request" }, 400); }

    const built = buildSession(body, env.SITE_URL);
    if (built.error) return json({ error: built.error }, 400);

    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: encode(built.params),
    });
    const data = await res.json();
    if (!res.ok) {
      console.log("Stripe error:", JSON.stringify(data.error || data));
      return json({ error: "Could not start checkout" }, 502);
    }
    return json({ url: data.url });
  },
};

/** Validate the cart and turn it into Stripe Checkout Session params. Exported for tests. */
export function buildSession(body, siteUrl) {
  const items = Array.isArray(body?.items) ? body.items : null;
  if (!items || !items.length) return { error: "Cart is empty" };
  if (items.length > MAX_LINES) return { error: "Too many items" };

  const ful = FULFILLMENT[body.fulfillment] || FULFILLMENT.pickup;
  const line_items = [];
  const summary = [];

  for (const it of items) {
    const p = CATALOG[it?.id];
    const qty = Number.parseInt(it?.qty, 10);
    if (!p) return { error: "Unknown product" };
    if (!p.sizes.includes(it.size)) return { error: `Invalid size for ${p.name}` };
    if (p.soldOut || (p.soldOutSizes || []).includes(it.size)) return { error: `${p.name} (${it.size}) is sold out` };
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) return { error: "Invalid quantity" };

    const name = `${p.name} (${it.size})${p.preorder ? " · Pre-order" : ""}`;
    line_items.push({
      quantity: qty,
      price_data: {
        currency: "cad",
        unit_amount: p.price,
        product_data: {
          name,
          ...(p.preorder ? { description: "Pre-order: ready when the drop lands" } : {}),
        },
      },
    });
    summary.push(`${qty}x ${p.name} ${it.size}`);
  }

  const params = {
    mode: "payment",
    line_items,
    success_url: `${siteUrl}/success.html?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${siteUrl}/index.html?checkout=cancelled`,
    phone_number_collection: { enabled: true },
    allow_promotion_codes: true,   // codes are created in the Stripe dashboard (see SETUP.md)
    billing_address_collection: "auto",
    shipping_options: [{
      shipping_rate_data: {
        type: "fixed_amount",
        display_name: ful.label,
        fixed_amount: { amount: ful.amount, currency: "cad" },
      },
    }],
    // Shows up on the payment in the Stripe dashboard so the owner sees sizes + delivery at a glance
    metadata: { fulfillment: ful.label, order: summary.join(", ").slice(0, 490) },
    payment_intent_data: { description: `Fear the Sheaf · ${ful.label}` },
  };
  if (ful.needsAddress) params.shipping_address_collection = { allowed_countries: ["CA"] };
  else params.custom_text = { submit: { message: "Pickup in Martensville. We'll text or email you when your order is ready." } };

  return { params };
}

/** Stripe wants nested form encoding: line_items[0][price_data][currency]=cad */
export function encode(obj, prefix = "", out = []) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v === undefined || v === null) continue;
    if (typeof v === "object") encode(v, key, out);
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return out.join("&");
}
