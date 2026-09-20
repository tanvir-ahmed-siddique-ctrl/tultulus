const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

process.env.SQUARE_ENVIRONMENT = "sandbox";
process.env.SQUARE_APPLICATION_ID = "sandbox-app-id";
process.env.SQUARE_LOCATION_ID = "sandbox-location";
process.env.SQUARE_ACCESS_TOKEN = "sandbox-token";
process.env.SQUARE_SHIPPING_FEE_CENTS = "500";
process.env.FIREBASE_PROJECT_ID = "tultulus";
process.env.PROMO_CODE = "Ethika05";
process.env.PROMO_DISCOUNT_PERCENT = "5";

const checkoutAttemptId = "12345678-1234-4234-8234-123456789012";
const paymentAttemptId = "22345678-1234-4234-8234-123456789012";

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function buyer() {
  return {
    email: "buyer@example.com",
    first: "Test",
    last: "Buyer",
    phone: "+12125550123",
    country: "US",
    street: "1 Main Street",
    address2: "Apt 2",
    careOf: "Front Desk",
    city: "New York",
    state: "NY",
    zip: "10001",
  };
}

function preparedOrder({ paid = false } = {}) {
  return {
    id: "square-order-1",
    location_id: "sandbox-location",
    reference_id: `TULT-${checkoutAttemptId}`.slice(0, 40),
    state: paid ? "COMPLETED" : "OPEN",
    line_items: [{
      name: "Verified shirt",
      quantity: "1",
      note: "Size: M",
      base_price_money: { amount: 5000, currency: "USD" },
      total_money: { amount: 5000, currency: "USD" },
    }],
    discounts: [{ amount_money: { amount: 250, currency: "USD" } }],
    service_charges: [{ amount_money: { amount: 500, currency: "USD" } }],
    total_money: { amount: 5250, currency: "USD" },
    fulfillments: [{
      type: "SHIPMENT",
      shipment_details: {
        recipient: {
          display_name: "Test Buyer",
          email_address: "buyer@example.com",
          phone_number: "+12125550123",
          address: {
            address_line_1: "1 Main Street",
            address_line_2: "Apt 2",
            locality: "New York",
            administrative_district_level_1: "NY",
            postal_code: "10001",
            country: "US",
          },
        },
      },
    }],
    ...(paid ? { tenders: [{ payment_id: "square-payment-1" }] } : {}),
  };
}

function completedPayment() {
  return {
    id: "square-payment-1",
    order_id: "square-order-1",
    location_id: "sandbox-location",
    status: "COMPLETED",
    amount_money: { amount: 5250, currency: "USD" },
    receipt_number: "ABCD",
    receipt_url: "https://squareup.com/receipt/example",
    buyer_email_address: "buyer@example.com",
    card_details: { card: { card_brand: "MASTERCARD", last_4: "4444" } },
  };
}

function pendingAchPayment() {
  return {
    id: "square-ach-payment-1",
    order_id: "square-order-1",
    location_id: "sandbox-location",
    status: "PENDING",
    source_type: "BANK_ACCOUNT",
    amount_money: { amount: 5250, currency: "USD" },
    buyer_email_address: "buyer@example.com",
    bank_account_details: {
      bank_name: "Test Bank",
      transfer_type: "ACH",
      country: "US",
      fingerprint: "must-never-be-public",
      ach_details: {
        routing_number: "011111111",
        account_number_suffix: "6789",
        account_type: "CHECKING",
      },
    },
  };
}

test("quote uses Firestore price and creates an idempotent Square order", async () => {
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url).includes("/documents/products/__checkout_settings__")) {
      return response({
        fields: {
          promoCode: { stringValue: "Ethika05" },
          promoDiscountPercent: { integerValue: "5" },
          promoEnabled: { booleanValue: true },
        },
      });
    }
    if (String(url).includes("firestore.googleapis.com")) {
      return response({
        fields: {
          name: { stringValue: "Verified shirt" },
          priceCurrent: { integerValue: "50" },
          isPublished: { booleanValue: true },
        },
      });
    }
    if (String(url).endsWith("/v2/orders") && options.method === "POST") {
      const submitted = JSON.parse(options.body);
      assert.equal(submitted.idempotency_key, `order-${checkoutAttemptId}`);
      assert.equal(submitted.order.line_items[0].base_price_money.amount, 5000);
      assert.equal(submitted.order.discounts[0].amount_money.amount, 250);
      const address = submitted.order.fulfillments[0].shipment_details.recipient.address;
      assert.equal(address.address_line_1, "1 Main Street");
      assert.equal(address.address_line_2, "Apt 2");
      assert.equal(address.address_line_3, "C/O Front Desk");
      assert.equal(address.administrative_district_level_1, "NY");
      assert.equal(address.postal_code, "10001");
      assert.equal(address.country, "US");
      return response({ order: preparedOrder() });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  try {
    const { handler } = require("../netlify/functions/square-quote");
    const result = await handler({
      httpMethod: "POST",
      body: JSON.stringify({
        checkoutAttemptId,
        cart: [{ productId: "product-1", quantity: 1, size: "M" }],
        billing: buyer(),
        promoCode: "Ethika05",
      }),
    });
    assert.equal(result.statusCode, 200);
    const payload = JSON.parse(result.body);
    assert.equal(payload.orderId, "square-order-1");
    assert.equal(payload.subtotalCents, 5000);
    assert.equal(payload.discountCents, 250);
    assert.equal(payload.shippingFeeCents, 500);
    assert.equal(payload.totalCents, 5250);
    assert.equal(requests.length, 3);
  } finally {
    global.fetch = originalFetch;
  }
});

test("orders at the free-shipping threshold do not add a shipping fee", async () => {
  const originalFetch = global.fetch;
  process.env.SQUARE_SHIPPING_FEE_CENTS = "700";
  process.env.SQUARE_FREE_SHIPPING_THRESHOLD_CENTS = "15000";
  global.fetch = async (url) => {
    if (String(url).includes("__checkout_settings__")) return response({ fields: {} });
    return response({
      fields: {
        name: { stringValue: "Threshold item" },
        priceCurrent: { integerValue: "50" },
        isPublished: { booleanValue: true },
      },
    });
  };
  try {
    const { buildVerifiedOrder } = require("../netlify/lib/square");
    const verified = await buildVerifiedOrder(
      [{ productId: "product-1", quantity: 3 }],
      buyer(),
      "",
    );
    assert.equal(verified.subtotalCents, 15000);
    assert.equal(verified.shippingFeeCents, 0);
    assert.equal(verified.shippingFeeWaived, true);
    assert.equal(verified.totalCents, 15000);
  } finally {
    global.fetch = originalFetch;
    process.env.SQUARE_SHIPPING_FEE_CENTS = "500";
  }
});

test("payment charges the prepared order and returns Mastercard receipt data", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.endsWith("/v2/orders/square-order-1")) return response({ order: preparedOrder() });
    if (target.endsWith("/v2/payments") && options.method === "POST") {
      const submitted = JSON.parse(options.body);
      assert.equal(submitted.amount_money.amount, 5250);
      assert.equal(submitted.order_id, "square-order-1");
      assert.equal(submitted.idempotency_key, `pay-${checkoutAttemptId}`);
      return response({ payment: completedPayment() });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  try {
    const { handler } = require("../netlify/functions/create-square-payment");
    const result = await handler({
      httpMethod: "POST",
      body: JSON.stringify({
        sourceId: "sandbox-card-token",
        orderId: "square-order-1",
        checkoutAttemptId,
        paymentAttemptId,
        expectedAmountCents: 5250,
      }),
    });
    assert.equal(result.statusCode, 200);
    const payload = JSON.parse(result.body);
    assert.equal(payload.success, true);
    assert.equal(payload.payment.status, "COMPLETED");
    assert.equal(payload.payment.cardBrand, "MASTERCARD");
    assert.equal(payload.payment.last4, "4444");
    assert.match(payload.payment.receiptUrl, /^https:\/\/squareup\.com/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("ACH starts one full-balance pending transfer and exposes only safe bank details", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.endsWith("/v2/orders/square-order-1")) return response({ order: preparedOrder() });
    if (target.endsWith("/v2/payments") && options.method === "POST") {
      const submitted = JSON.parse(options.body);
      assert.equal(submitted.source_id, "bauth:sandbox-ach-token");
      assert.equal(submitted.idempotency_key, `ach-${checkoutAttemptId}`);
      assert.equal(submitted.amount_money.amount, 5250);
      assert.equal(submitted.amount_money.currency, "USD");
      assert.equal(submitted.autocomplete, true);
      assert.equal(submitted.order_id, "square-order-1");
      assert.equal(Object.hasOwn(submitted, "verification_token"), false);
      return response({ payment: pendingAchPayment() });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  try {
    const { handler } = require("../netlify/functions/create-ach-payment");
    const result = await handler({
      httpMethod: "POST",
      body: JSON.stringify({
        sourceId: "bauth:sandbox-ach-token",
        orderId: "square-order-1",
        checkoutAttemptId,
        expectedAmountCents: 5250,
      }),
    });
    assert.equal(result.statusCode, 202);
    const payload = JSON.parse(result.body);
    assert.equal(payload.success, true);
    assert.equal(payload.pending, true);
    assert.equal(payload.payment.status, "PENDING");
    assert.equal(payload.payment.sourceType, "BANK_ACCOUNT");
    assert.equal(payload.payment.bankName, "Test Bank");
    assert.equal(payload.payment.last4, "6789");
    assert.equal(JSON.stringify(payload).includes("011111111"), false);
    assert.equal(JSON.stringify(payload).includes("must-never-be-public"), false);
  } finally {
    global.fetch = originalFetch;
  }
});

test("ACH retry reuses an existing pending payment instead of creating another debit", async () => {
  const originalFetch = global.fetch;
  let createCalls = 0;
  global.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.endsWith("/v2/orders/square-order-1")) {
      const order = preparedOrder();
      order.tenders = [{ payment_id: "square-ach-payment-1" }];
      return response({ order });
    }
    if (target.endsWith("/v2/payments/square-ach-payment-1")) {
      return response({ payment: pendingAchPayment() });
    }
    if (target.endsWith("/v2/payments") && options.method === "POST") {
      createCalls += 1;
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  try {
    const { handler } = require("../netlify/functions/create-ach-payment");
    const result = await handler({
      httpMethod: "POST",
      body: JSON.stringify({
        sourceId: "bauth:sandbox-ach-token",
        orderId: "square-order-1",
        checkoutAttemptId,
        expectedAmountCents: 5250,
      }),
    });
    assert.equal(result.statusCode, 202);
    assert.equal(createCalls, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test("pending ACH notification goes only to the seller and never reveals routing data", async () => {
  const originalFetch = global.fetch;
  const previous = {
    apiKey: process.env.RESEND_API_KEY,
    from: process.env.RESEND_FROM_EMAIL,
    seller: process.env.SELLER_NOTIFICATION_EMAIL,
  };
  process.env.RESEND_API_KEY = "re_test";
  process.env.RESEND_FROM_EMAIL = "Tultulus <orders@example.com>";
  process.env.SELLER_NOTIFICATION_EMAIL = "seller@example.com";
  const sends = [];
  global.fetch = async (url, options = {}) => {
    sends.push({ url: String(url), options });
    return response({ id: "email-1" });
  };

  try {
    const { sendAchPendingNotification } = require("../netlify/lib/square");
    await sendAchPendingNotification(pendingAchPayment(), preparedOrder());
    assert.equal(sends.length, 1);
    const message = JSON.parse(sends[0].options.body);
    assert.deepEqual(message.to, ["seller@example.com"]);
    assert.match(message.subject, /ACH transfer pending/);
    assert.match(message.html, /Do not confirm or ship/);
    assert.match(message.html, /Test Buyer/);
    assert.match(message.html, /ending in 6789/);
    assert.equal(message.html.includes("011111111"), false);
    assert.equal(message.html.includes("must-never-be-public"), false);
  } finally {
    global.fetch = originalFetch;
    if (previous.apiKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previous.apiKey;
    if (previous.from === undefined) delete process.env.RESEND_FROM_EMAIL;
    else process.env.RESEND_FROM_EMAIL = previous.from;
    if (previous.seller === undefined) delete process.env.SELLER_NOTIFICATION_EMAIL;
    else process.env.SELLER_NOTIFICATION_EMAIL = previous.seller;
  }
});

test("webhook rejects a forged signature", async () => {
  process.env.SQUARE_WEBHOOK_SIGNATURE_KEY = "test-signature-key";
  process.env.SQUARE_WEBHOOK_NOTIFICATION_URL = "https://example.com/.netlify/functions/square-webhook";
  const { handler } = require("../netlify/functions/square-webhook");
  const result = await handler({
    httpMethod: "POST",
    body: JSON.stringify({ type: "payment.updated" }),
    headers: { "x-square-hmacsha256-signature": crypto.randomBytes(32).toString("base64") },
  });
  assert.equal(result.statusCode, 403);
});

test("signed ACH completion webhook sends final confirmation to buyer and seller", async () => {
  const originalFetch = global.fetch;
  const previous = {
    apiKey: process.env.RESEND_API_KEY,
    from: process.env.RESEND_FROM_EMAIL,
    seller: process.env.SELLER_NOTIFICATION_EMAIL,
  };
  process.env.RESEND_API_KEY = "re_test";
  process.env.RESEND_FROM_EMAIL = "Tultulus <orders@example.com>";
  process.env.SELLER_NOTIFICATION_EMAIL = "seller@example.com";
  process.env.SQUARE_WEBHOOK_SIGNATURE_KEY = "test-signature-key";
  process.env.SQUARE_WEBHOOK_NOTIFICATION_URL = "https://example.com/.netlify/functions/square-webhook";
  const completedAch = { ...pendingAchPayment(), status: "COMPLETED", receipt_url: "https://squareup.com/receipt/ach" };
  const sentTo = [];
  global.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.endsWith("/v2/payments/square-ach-payment-1")) return response({ payment: completedAch });
    if (target.endsWith("/v2/orders/square-order-1")) return response({ order: preparedOrder() });
    if (target === "https://api.resend.com/emails") {
      sentTo.push(JSON.parse(options.body).to[0]);
      return response({ id: `email-${sentTo.length}` });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  const rawBody = JSON.stringify({
    type: "payment.updated",
    data: { object: { payment: { id: completedAch.id, order_id: completedAch.order_id, status: "COMPLETED" } } },
  });
  const signature = crypto
    .createHmac("sha256", process.env.SQUARE_WEBHOOK_SIGNATURE_KEY)
    .update(process.env.SQUARE_WEBHOOK_NOTIFICATION_URL + rawBody)
    .digest("base64");

  try {
    const { handler } = require("../netlify/functions/square-webhook");
    const result = await handler({
      httpMethod: "POST",
      body: rawBody,
      headers: { "x-square-hmacsha256-signature": signature },
    });
    assert.equal(result.statusCode, 200);
    assert.deepEqual(sentTo.sort(), ["buyer@example.com", "seller@example.com"]);
  } finally {
    global.fetch = originalFetch;
    if (previous.apiKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previous.apiKey;
    if (previous.from === undefined) delete process.env.RESEND_FROM_EMAIL;
    else process.env.RESEND_FROM_EMAIL = previous.from;
    if (previous.seller === undefined) delete process.env.SELLER_NOTIFICATION_EMAIL;
    else process.env.SELLER_NOTIFICATION_EMAIL = previous.seller;
  }
});
