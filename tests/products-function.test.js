const assert = require("node:assert/strict");
const test = require("node:test");

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("catalog endpoint returns only published products with CDN cache headers", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => response({
    documents: [
      {
        name: "projects/tultulus/databases/(default)/documents/products/live-1",
        fields: {
          name: { stringValue: "Fast Tee" },
          priceCurrent: { integerValue: "45" },
          isPublished: { booleanValue: true },
          images: { arrayValue: { values: [{ stringValue: "https://example.com/tee.jpg" }] } },
        },
      },
      {
        name: "projects/tultulus/databases/(default)/documents/products/draft-1",
        fields: { name: { stringValue: "Draft" }, isPublished: { booleanValue: false } },
      },
      {
        name: "projects/tultulus/databases/(default)/documents/products/__checkout_settings__",
        fields: { promoCode: { stringValue: "PRIVATE" }, isPublished: { booleanValue: false } },
      },
    ],
  });

  try {
    const { handler } = require("../netlify/functions/products");
    const result = await handler({ httpMethod: "GET", headers: {} });
    const payload = JSON.parse(result.body);
    assert.equal(result.statusCode, 200);
    assert.equal(payload.products.length, 1);
    assert.equal(payload.products[0].id, "live-1");
    assert.equal(payload.products[0].name, "Fast Tee");
    assert.match(result.headers["Cache-Control"], /max-age=300/);
    assert.match(result.headers["Netlify-CDN-Cache-Control"], /s-maxage=300/);
    assert.ok(result.headers.ETag);
  } finally {
    global.fetch = originalFetch;
  }
});
