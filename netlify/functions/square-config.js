const { getCheckoutConfig, jsonResponse } = require("../lib/square");

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  try {
    const config = await getCheckoutConfig();
    return jsonResponse(200, {
      applicationId: config.applicationId,
      locationId: config.locationId,
      environment: config.environment,
      currency: config.currency,
      shippingFeeCents: config.shippingFeeCents,
      freeShippingThresholdCents: config.freeShippingThresholdCents,
      promoDiscountPercent: config.promoDiscountPercent,
    });
  } catch (error) {
    return jsonResponse(error.statusCode || 500, {
      error: error.message || "Square checkout is unavailable.",
      code: error.code || "CONFIG_ERROR",
    });
  }
};
