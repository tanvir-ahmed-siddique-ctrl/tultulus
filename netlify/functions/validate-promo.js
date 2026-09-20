const { cleanText, getCheckoutConfig, jsonResponse } = require("../lib/square");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const submittedCode = cleanText(body.promoCode, 64);
    const config = await getCheckoutConfig();
    const valid = Boolean(
      submittedCode
      && submittedCode.toLowerCase() === String(config.promoCode || "").toLowerCase()
      && config.promoDiscountPercent > 0,
    );
    return jsonResponse(200, {
      valid,
      discountPercent: valid ? config.promoDiscountPercent : 0,
    });
  } catch (error) {
    return jsonResponse(400, { error: "Invalid promo request." });
  }
};
