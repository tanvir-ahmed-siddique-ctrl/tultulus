const crypto = require("crypto");

const SQUARE_API_VERSION = "2026-08-19";
const DEFAULT_FIREBASE_PROJECT_ID = "tultulus";

class CheckoutError extends Error {
  constructor(statusCode, message, code = "CHECKOUT_ERROR", details = undefined) {
    super(message);
    this.name = "CheckoutError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
    body: JSON.stringify(payload),
  };
}

function cleanText(value, maxLength = 255) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function parsePositiveInteger(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function getSquareConfig({ requireSecret = false } = {}) {
  const environment = String(process.env.SQUARE_ENVIRONMENT || "sandbox").toLowerCase();
  if (!new Set(["sandbox", "production"]).has(environment)) {
    throw new CheckoutError(500, "SQUARE_ENVIRONMENT must be sandbox or production.", "INVALID_SERVER_CONFIG");
  }

  const config = {
    environment,
    applicationId: cleanText(process.env.SQUARE_APPLICATION_ID, 128),
    locationId: cleanText(process.env.SQUARE_LOCATION_ID, 64),
    accessToken: cleanText(process.env.SQUARE_ACCESS_TOKEN, 512),
    currency: "USD",
    shippingFeeCents: parsePositiveInteger(process.env.SQUARE_SHIPPING_FEE_CENTS, 700),
    freeShippingThresholdCents: parsePositiveInteger(process.env.SQUARE_FREE_SHIPPING_THRESHOLD_CENTS, 15_000),
    promoCode: cleanText(process.env.PROMO_CODE || "Ethika05", 64),
    promoDiscountPercent: Math.min(
      100,
      parsePositiveInteger(process.env.PROMO_DISCOUNT_PERCENT, 5),
    ),
  };

  if (!config.applicationId || !config.locationId || (requireSecret && !config.accessToken)) {
    throw new CheckoutError(
      503,
      "Square checkout is not configured yet.",
      "SQUARE_NOT_CONFIGURED",
    );
  }

  return config;
}

async function getCheckoutConfig({ requireSecret = false } = {}) {
  const config = getSquareConfig({ requireSecret });
  const projectId = cleanText(process.env.FIREBASE_PROJECT_ID || DEFAULT_FIREBASE_PROJECT_ID, 128);
  const firebaseApiKey = cleanText(process.env.FIREBASE_WEB_API_KEY, 256);
  const keyQuery = firebaseApiKey ? `?key=${encodeURIComponent(firebaseApiKey)}` : "";
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/products/__checkout_settings__${keyQuery}`;

  try {
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) return config;
    const document = await response.json();
    const settings = Object.fromEntries(
      Object.entries(document.fields || {}).map(([key, value]) => [key, decodeFirestoreValue(value)]),
    );
    const enabled = settings.promoEnabled !== false;
    const savedCode = cleanText(settings.promoCode, 64);
    const savedPercent = Math.min(100, parsePositiveInteger(settings.promoDiscountPercent, 0));
    if (savedCode) config.promoCode = savedCode;
    config.promoDiscountPercent = enabled ? savedPercent : 0;
  } catch (error) {
    console.warn("Using environment promo settings because Firestore settings could not be loaded.");
  }
  return config;
}

function squareBaseUrl(environment) {
  return environment === "production"
    ? "https://connect.squareup.com"
    : "https://connect.squareupsandbox.com";
}

async function squareRequest(path, { method = "GET", body } = {}) {
  const config = getSquareConfig({ requireSecret: true });
  const response = await fetch(`${squareBaseUrl(config.environment)}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      "Content-Type": "application/json",
      "Square-Version": SQUARE_API_VERSION,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }

  if (!response.ok || payload.errors?.length) {
    const firstError = payload.errors?.[0] || {};
    const publicMessage = cleanText(firstError.detail || "Square could not process this request.", 300);
    throw new CheckoutError(
      response.status >= 400 && response.status < 500 ? response.status : 502,
      publicMessage,
      cleanText(firstError.code || "SQUARE_API_ERROR", 80),
    );
  }

  return payload;
}

function decodeFirestoreValue(value) {
  if (!value || typeof value !== "object") return null;
  if (Object.prototype.hasOwnProperty.call(value, "nullValue")) return null;
  if (Object.prototype.hasOwnProperty.call(value, "stringValue")) return value.stringValue;
  if (Object.prototype.hasOwnProperty.call(value, "booleanValue")) return value.booleanValue;
  if (Object.prototype.hasOwnProperty.call(value, "integerValue")) return Number(value.integerValue);
  if (Object.prototype.hasOwnProperty.call(value, "doubleValue")) return Number(value.doubleValue);
  if (value.arrayValue) return (value.arrayValue.values || []).map(decodeFirestoreValue);
  if (value.mapValue) {
    return Object.fromEntries(
      Object.entries(value.mapValue.fields || {}).map(([key, nested]) => [key, decodeFirestoreValue(nested)]),
    );
  }
  return null;
}

async function fetchProduct(productId) {
  const projectId = cleanText(process.env.FIREBASE_PROJECT_ID || DEFAULT_FIREBASE_PROJECT_ID, 128);
  const firebaseApiKey = cleanText(process.env.FIREBASE_WEB_API_KEY, 256);
  const keyQuery = firebaseApiKey ? `?key=${encodeURIComponent(firebaseApiKey)}` : "";
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/products/${encodeURIComponent(productId)}${keyQuery}`;
  const response = await fetch(url, { headers: { Accept: "application/json" } });

  if (response.status === 404) {
    throw new CheckoutError(409, "A product in your cart is no longer available.", "PRODUCT_NOT_FOUND");
  }
  if (!response.ok) {
    throw new CheckoutError(502, "Could not verify the latest product prices.", "PRODUCT_LOOKUP_FAILED");
  }

  const document = await response.json();
  const product = Object.fromEntries(
    Object.entries(document.fields || {}).map(([key, value]) => [key, decodeFirestoreValue(value)]),
  );
  product.id = productId;
  return product;
}

function dollarsToCents(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.round(amount * 100);
}

const US_STATE_CODES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID",
  "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO",
  "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA",
  "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
]);

function normalizeAddress(raw = {}) {
  const addressLine1 = cleanText(raw.street, 160);
  const locality = cleanText(raw.city, 80);
  const administrativeDistrictLevel1 = cleanText(raw.state, 80);
  const postalCode = cleanText(raw.zip || raw.postcode, 20);
  const country = cleanText(raw.country, 2).toUpperCase();
  const addressLine2 = cleanText(raw.address2 || raw.apartment, 100);
  const careOf = cleanText(raw.careOf, 100);
  if (
    !addressLine1
    || !locality
    || !administrativeDistrictLevel1
    || !/^[A-Z0-9][A-Z0-9 -]{2,19}$/i.test(postalCode)
    || !/^[A-Z]{2}$/.test(country)
    || (country === "US" && !US_STATE_CODES.has(administrativeDistrictLevel1.toUpperCase()))
  ) {
    throw new CheckoutError(400, "A complete shipping address is required.", "INVALID_ADDRESS");
  }
  return {
    address_line_1: addressLine1,
    ...(addressLine2 ? { address_line_2: addressLine2 } : {}),
    ...(careOf ? { address_line_3: `C/O ${careOf}` } : {}),
    locality,
    administrative_district_level_1: country === "US" ? administrativeDistrictLevel1.toUpperCase() : administrativeDistrictLevel1,
    postal_code: postalCode,
    country,
  };
}

function normalizeBuyer(raw = {}) {
  const email = cleanText(raw.email, 255).toLowerCase();
  const firstName = cleanText(raw.first, 80);
  const lastName = cleanText(raw.last, 80);
  const phone = cleanText(raw.phone, 40);
  if (!firstName || !lastName || !email || !/^\S+@\S+\.\S+$/.test(email) || !phone) {
    throw new CheckoutError(400, "Valid customer name, email, and phone are required.", "INVALID_CUSTOMER");
  }
  return {
    email,
    firstName,
    lastName,
    phone,
    notes: cleanText(raw.notes, 500),
    address: normalizeAddress(raw),
  };
}

async function buildVerifiedOrder(rawCart, rawBuyer, submittedPromoCode) {
  if (!Array.isArray(rawCart) || rawCart.length < 1 || rawCart.length > 25) {
    throw new CheckoutError(400, "Your cart must contain between 1 and 25 items.", "INVALID_CART");
  }

  const buyer = normalizeBuyer(rawBuyer);
  const normalizedItems = rawCart.map((item) => {
    const productId = cleanText(item.productId, 128);
    const quantity = Number.parseInt(String(item.quantity ?? "1"), 10);
    if (!productId || !Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
      throw new CheckoutError(
        400,
        "Your cart is outdated. Remove and add the product again.",
        "INVALID_CART_ITEM",
      );
    }
    return {
      productId,
      quantity,
      size: cleanText(item.size, 50),
      color: cleanText(item.color, 50),
    };
  });

  const productIds = [...new Set(normalizedItems.map((item) => item.productId))];
  const products = await Promise.all(productIds.map(fetchProduct));
  const productById = new Map(products.map((product) => [product.id, product]));

  const lineItems = normalizedItems.map((item) => {
    const product = productById.get(item.productId);
    const priceCents = dollarsToCents(product?.priceCurrent ?? product?.price);
    if (!product || product.isPublished === false || !priceCents) {
      throw new CheckoutError(409, "A product in your cart is no longer available.", "PRODUCT_UNAVAILABLE");
    }
    const selections = [item.color && `Color: ${item.color}`, item.size && `Size: ${item.size}`]
      .filter(Boolean)
      .join(" · ");
    return {
      name: cleanText(product.name || "Product", 120),
      quantity: String(item.quantity),
      ...(selections ? { note: cleanText(selections, 500) } : {}),
      base_price_money: { amount: priceCents, currency: "USD" },
    };
  });

  const config = await getCheckoutConfig({ requireSecret: true });
  const promoApplied =
    submittedPromoCode
    && String(submittedPromoCode).toLowerCase() === String(config.promoCode || "").toLowerCase()
    && config.promoDiscountPercent > 0;
  const subtotalCents = lineItems.reduce(
    (sum, item) => sum + item.base_price_money.amount * Number(item.quantity),
    0,
  );
  const discountCents = promoApplied
    ? Math.round(subtotalCents * (config.promoDiscountPercent / 100))
    : 0;
  const discounts = promoApplied
    ? [{
        uid: "checkout-promo",
        name: "Promotional discount",
        amount_money: { amount: discountCents, currency: "USD" },
        scope: "ORDER",
      }]
    : undefined;
  const shippingFeeCents = subtotalCents >= config.freeShippingThresholdCents
    ? 0
    : config.shippingFeeCents;
  const serviceCharges = shippingFeeCents > 0
    ? [{
        uid: "shipping-fee",
        name: "Shipping fee",
        amount_money: { amount: shippingFeeCents, currency: "USD" },
        calculation_phase: "SUBTOTAL_PHASE",
      }]
    : undefined;

  return {
    buyer,
    lineItems,
    discounts,
    serviceCharges,
    promoApplied,
    subtotalCents,
    discountCents,
    shippingFeeCents,
    freeShippingThresholdCents: config.freeShippingThresholdCents,
    shippingFeeWaived: subtotalCents >= config.freeShippingThresholdCents,
    totalCents: subtotalCents - discountCents + shippingFeeCents,
  };
}

async function createVerifiedSquareOrder(verified, checkoutAttemptId) {
  const config = getSquareConfig({ requireSecret: true });
  const referenceId = `TULT-${checkoutAttemptId}`.slice(0, 40);
  const orderResponse = await squareRequest("/v2/orders", {
    method: "POST",
    body: {
      idempotency_key: `order-${checkoutAttemptId}`,
      order: {
        location_id: config.locationId,
        reference_id: referenceId,
        line_items: verified.lineItems,
        ...(verified.discounts ? { discounts: verified.discounts } : {}),
        ...(verified.serviceCharges ? { service_charges: verified.serviceCharges } : {}),
        fulfillments: [{
          type: "SHIPMENT",
          state: "PROPOSED",
          shipment_details: {
            recipient: {
              display_name: `${verified.buyer.firstName} ${verified.buyer.lastName}`,
              email_address: verified.buyer.email,
              phone_number: verified.buyer.phone,
              address: verified.buyer.address,
            },
            ...(verified.buyer.notes ? { shipping_note: verified.buyer.notes } : {}),
          },
        }],
      },
    },
  });
  const order = orderResponse.order;
  if (
    !order?.id
    || !Number.isSafeInteger(order.total_money?.amount)
    || order.total_money.amount !== verified.totalCents
    || order.total_money.currency !== "USD"
  ) {
    throw new CheckoutError(
      409,
      "Square calculated a different order total. No payment was taken.",
      "ORDER_TOTAL_MISMATCH",
    );
  }
  return { order, referenceId };
}

function formatUsd(cents) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    Number(cents || 0) / 100,
  );
}

function getOrderRecipient(order) {
  return order?.fulfillments?.[0]?.shipment_details?.recipient || {};
}

function getSafeBankDetails(payment) {
  const details = payment?.bank_account_details || {};
  const ach = details.ach_details || {};
  return {
    bankName: cleanText(details.bank_name || "U.S. bank", 120),
    accountType: cleanText(ach.account_type || "Bank account", 40),
    last4: cleanText(ach.account_number_suffix, 4),
    country: cleanText(details.country || "US", 2).toUpperCase(),
  };
}

function renderOrderItems(order) {
  return (order?.line_items || [])
    .map((item) => `<tr><td style="padding:10px 8px;border-bottom:1px solid #eee">${escapeHtml(item.name)}${item.note ? ` <small>(${escapeHtml(item.note)})</small>` : ""}</td><td style="padding:10px 8px;border-bottom:1px solid #eee;text-align:center">${escapeHtml(item.quantity)}</td><td style="padding:10px 8px;border-bottom:1px solid #eee;text-align:right">${formatUsd(item.total_money?.amount || 0)}</td></tr>`)
    .join("");
}

function renderShippingDetails(payment, order) {
  const recipient = getOrderRecipient(order);
  const address = recipient.address || payment.shipping_address || {};
  const addressText = [
    address.address_line_1,
    address.address_line_2,
    address.address_line_3,
    address.locality,
    address.administrative_district_level_1,
    address.postal_code,
    address.country,
  ].filter(Boolean).map(escapeHtml).join(", ");
  return `${escapeHtml(recipient.display_name || "")}<br>${addressText}<br>
    ${escapeHtml(recipient.phone_number || "")}<br>${escapeHtml(recipient.email_address || payment.buyer_email_address || "")}`;
}

function renderOrderEmail({ payment, order, seller = false }) {
  const recipient = getOrderRecipient(order);
  const items = renderOrderItems(order);
  const bank = payment.source_type === "BANK_ACCOUNT" ? getSafeBankDetails(payment) : null;
  const paymentMethod = bank
    ? `${bank.bankName}${bank.last4 ? ` ending in ${bank.last4}` : ""} (${bank.accountType})`
    : `${cleanText(payment.card_details?.card?.card_brand || "Card", 40)}${payment.card_details?.card?.last_4 ? ` ending in ${cleanText(payment.card_details.card.last_4, 4)}` : ""}`;
  const receiptLink = payment.receipt_url
    ? `<p><a href="${escapeHtml(payment.receipt_url)}">View official Square receipt</a></p>`
    : "";
  const orderNote = order?.fulfillments?.[0]?.shipment_details?.shipping_note;

  return `
    <div style="font-family:Arial,sans-serif;color:#1f1f1f;line-height:1.6;max-width:640px;margin:auto">
      <h1 style="font-size:24px">${seller ? "New paid order" : "Your Tultulus order is confirmed"}</h1>
      <p>Payment status: <strong>${escapeHtml(payment.status)}</strong></p>
      <p>Order ID: <strong>${escapeHtml(order.id)}</strong><br>
      Payment ID: <strong>${escapeHtml(payment.id)}</strong><br>
      Payment method: <strong>${escapeHtml(paymentMethod)}</strong><br>
      Total paid: <strong>${formatUsd(payment.amount_money?.amount)}</strong></p>
      <h2 style="font-size:18px">Order summary</h2>
      <table style="width:100%;border-collapse:collapse;font-size:14px"><thead><tr><th style="text-align:left;padding:8px">Item</th><th style="padding:8px">Qty</th><th style="text-align:right;padding:8px">Amount</th></tr></thead><tbody>${items}</tbody></table>
      <p style="text-align:right;font-size:18px"><strong>Total paid: ${formatUsd(payment.amount_money?.amount)}</strong></p>
      <h2 style="font-size:18px">Shipping details</h2>
      <p>${renderShippingDetails(payment, order)}</p>
      ${orderNote ? `<h2 style="font-size:18px">Order note</h2><p>${escapeHtml(orderNote)}</p>` : ""}
      ${receiptLink}
      <p style="color:#666;font-size:12px">This message was generated from a verified Square payment.</p>
    </div>`;
}

function renderAchPendingEmail(payment, order) {
  const bank = getSafeBankDetails(payment);
  const orderNote = order?.fulfillments?.[0]?.shipment_details?.shipping_note;
  return `
    <div style="font-family:Arial,sans-serif;color:#1f1f1f;line-height:1.6;max-width:640px;margin:auto">
      <h1 style="font-size:24px">ACH bank transfer initiated</h1>
      <p style="padding:12px 14px;background:#fff4d6;border-left:4px solid #b7791f"><strong>Payment is pending. Do not confirm or ship this order until Square marks it COMPLETED.</strong></p>
      <p>Payment status: <strong>PENDING</strong><br>
      Order ID: <strong>${escapeHtml(order.id)}</strong><br>
      Payment ID: <strong>${escapeHtml(payment.id)}</strong><br>
      Amount pending: <strong>${formatUsd(payment.amount_money?.amount)}</strong></p>
      <h2 style="font-size:18px">Bank transfer details</h2>
      <p>Bank: <strong>${escapeHtml(bank.bankName)}</strong><br>
      Account: <strong>${escapeHtml(bank.accountType)}${bank.last4 ? ` ending in ${escapeHtml(bank.last4)}` : ""}</strong><br>
      Country: <strong>${escapeHtml(bank.country)}</strong></p>
      <h2 style="font-size:18px">Order summary</h2>
      <table style="width:100%;border-collapse:collapse;font-size:14px"><thead><tr><th style="text-align:left;padding:8px">Item</th><th style="padding:8px">Qty</th><th style="text-align:right;padding:8px">Amount</th></tr></thead><tbody>${renderOrderItems(order)}</tbody></table>
      <p style="text-align:right;font-size:18px"><strong>Total pending: ${formatUsd(payment.amount_money?.amount)}</strong></p>
      <h2 style="font-size:18px">Shipping details</h2>
      <p>${renderShippingDetails(payment, order)}</p>
      ${orderNote ? `<h2 style="font-size:18px">Order note</h2><p>${escapeHtml(orderNote)}</p>` : ""}
      <p style="color:#666;font-size:12px">For privacy and security, only the bank name, account type, and account-number suffix are shown.</p>
    </div>`;
}

function renderAchFailedEmail(payment, order, seller = false) {
  const bank = getSafeBankDetails(payment);
  return `
    <div style="font-family:Arial,sans-serif;color:#1f1f1f;line-height:1.6;max-width:640px;margin:auto">
      <h1 style="font-size:24px">ACH bank transfer failed</h1>
      <p>${seller ? "The pending bank transfer did not complete. Do not ship this order." : "Your bank transfer did not complete, so your order was not confirmed and must be placed again."}</p>
      <p>Payment status: <strong>FAILED</strong><br>
      Order ID: <strong>${escapeHtml(order.id)}</strong><br>
      Payment ID: <strong>${escapeHtml(payment.id)}</strong><br>
      Amount: <strong>${formatUsd(payment.amount_money?.amount)}</strong><br>
      Bank: <strong>${escapeHtml(bank.bankName)}${bank.last4 ? ` ending in ${escapeHtml(bank.last4)}` : ""}</strong></p>
      <p>Questions? Contact contactultul@gmail.com.</p>
    </div>`;
}

async function sendResendEmail({ to, subject, html, idempotencyKey }) {
  const apiKey = cleanText(process.env.RESEND_API_KEY, 512);
  const from = cleanText(process.env.RESEND_FROM_EMAIL, 255);
  if (!apiKey || !from || !to) return { skipped: true };
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({ from, to: [to], subject, html }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Email provider rejected the notification (${response.status}): ${body.slice(0, 200)}`);
  }
  return response.json();
}

async function sendPaymentNotifications(payment, order) {
  if (payment?.status !== "COMPLETED" || !payment?.id || !order?.id) {
    return { skipped: true };
  }
  const recipient = getOrderRecipient(order);
  const buyerEmail = cleanText(payment.buyer_email_address || recipient.email_address, 255).toLowerCase();
  const sellerEmail = cleanText(process.env.SELLER_NOTIFICATION_EMAIL, 255).toLowerCase();
  const total = formatUsd(payment.amount_money?.amount);
  const jobs = [];

  if (buyerEmail) {
    jobs.push(sendResendEmail({
      to: buyerEmail,
      subject: `Tultulus order confirmed — ${total}`,
      html: renderOrderEmail({ payment, order }),
      idempotencyKey: `buyer-paid/${payment.id}`,
    }));
  }
  if (sellerEmail) {
    jobs.push(sendResendEmail({
      to: sellerEmail,
      subject: `New paid Tultulus order — ${total}`,
      html: renderOrderEmail({ payment, order, seller: true }),
      idempotencyKey: `seller-paid/${payment.id}`,
    }));
  }

  const results = await Promise.allSettled(jobs);
  const summary = {
    attempted: jobs.length,
    failed: results.filter((result) => result.status === "rejected").length,
  };
  if (summary.failed > 0) {
    throw new Error("One or more payment notifications could not be delivered.");
  }
  return summary;
}

async function sendAchPendingNotification(payment, order) {
  if (
    payment?.status !== "PENDING"
    || payment?.source_type !== "BANK_ACCOUNT"
    || !payment?.id
    || !order?.id
  ) {
    return { skipped: true };
  }
  const sellerEmail = cleanText(process.env.SELLER_NOTIFICATION_EMAIL, 255).toLowerCase();
  if (!sellerEmail) return { skipped: true };
  return sendResendEmail({
    to: sellerEmail,
    subject: `ACH transfer pending — ${formatUsd(payment.amount_money?.amount)}`,
    html: renderAchPendingEmail(payment, order),
    idempotencyKey: `seller-ach-pending/${payment.id}`,
  });
}

async function sendAchFailedNotifications(payment, order) {
  if (
    payment?.status !== "FAILED"
    || payment?.source_type !== "BANK_ACCOUNT"
    || !payment?.id
    || !order?.id
  ) {
    return { skipped: true };
  }
  const recipient = getOrderRecipient(order);
  const buyerEmail = cleanText(payment.buyer_email_address || recipient.email_address, 255).toLowerCase();
  const sellerEmail = cleanText(process.env.SELLER_NOTIFICATION_EMAIL, 255).toLowerCase();
  const jobs = [];
  if (buyerEmail) {
    jobs.push(sendResendEmail({
      to: buyerEmail,
      subject: "Tultulus bank transfer failed — order not confirmed",
      html: renderAchFailedEmail(payment, order),
      idempotencyKey: `buyer-ach-failed/${payment.id}`,
    }));
  }
  if (sellerEmail) {
    jobs.push(sendResendEmail({
      to: sellerEmail,
      subject: `ACH transfer failed — ${formatUsd(payment.amount_money?.amount)}`,
      html: renderAchFailedEmail(payment, order, true),
      idempotencyKey: `seller-ach-failed/${payment.id}`,
    }));
  }
  const results = await Promise.allSettled(jobs);
  if (results.some((result) => result.status === "rejected")) {
    throw new Error("One or more ACH failure notifications could not be delivered.");
  }
  return { attempted: jobs.length, failed: 0 };
}

function verifySquareWebhookSignature(rawBody, signature) {
  const signatureKey = cleanText(process.env.SQUARE_WEBHOOK_SIGNATURE_KEY, 512);
  const notificationUrl = cleanText(process.env.SQUARE_WEBHOOK_NOTIFICATION_URL, 500);
  if (!signatureKey || !notificationUrl || !signature) return false;
  const expected = crypto
    .createHmac("sha256", signatureKey)
    .update(notificationUrl + rawBody)
    .digest("base64");
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(String(signature));
  return expectedBuffer.length === actualBuffer.length && crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

module.exports = {
  CheckoutError,
  buildVerifiedOrder,
  cleanText,
  createVerifiedSquareOrder,
  getSquareConfig,
  getCheckoutConfig,
  getSafeBankDetails,
  jsonResponse,
  sendAchFailedNotifications,
  sendAchPendingNotification,
  sendPaymentNotifications,
  squareRequest,
  verifySquareWebhookSignature,
};
