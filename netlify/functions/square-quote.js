const {
  CheckoutError,
  buildVerifiedOrder,
  cleanText,
  createVerifiedSquareOrder,
  getSquareConfig,
  jsonResponse,
} = require("../lib/square");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  try {
    if (!event.body || Buffer.byteLength(event.body, "utf8") > 50_000) {
      throw new CheckoutError(400, "Invalid checkout request.", "INVALID_REQUEST");
    }
    let body;
    try {
      body = JSON.parse(event.body);
    } catch {
      throw new CheckoutError(400, "Invalid checkout request.", "INVALID_JSON");
    }
    const verified = await buildVerifiedOrder(
      body.cart,
      body.billing,
      cleanText(body.promoCode, 64),
    );
    const checkoutAttemptId = cleanText(body.checkoutAttemptId, 45);
    if (!/^[a-zA-Z0-9_-]{16,45}$/.test(checkoutAttemptId)) {
      throw new CheckoutError(400, "Invalid checkout attempt.", "INVALID_CHECKOUT_ATTEMPT");
    }
    getSquareConfig({ requireSecret: true });
    const { order, referenceId } = await createVerifiedSquareOrder(verified, checkoutAttemptId);
    return jsonResponse(200, {
      orderId: order.id,
      referenceId,
      currency: "USD",
      subtotalCents: verified.subtotalCents,
      discountCents: verified.discountCents,
      shippingFeeCents: verified.shippingFeeCents,
      totalCents: verified.totalCents,
      promoApplied: verified.promoApplied,
    });
  } catch (error) {
    return jsonResponse(error.statusCode || 500, {
      error: error.message || "Could not verify your order total.",
      code: error.code || "QUOTE_ERROR",
    });
  }
};
