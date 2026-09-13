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
    status: "COMPLETED",
    amount_money: { amount: 5250, currency: "USD" },
    receipt_number: "ABCD",
    receipt_url: "https://squareup.com/receipt/example",
    buyer_email_address: "buyer@example.com",
    card_details: { card: { card_brand: "MASTERCARD", last_4: "4444" } },
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
      assert.equal(submitted.idempotency_key, `pay-${paymentAttemptId}`);
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
