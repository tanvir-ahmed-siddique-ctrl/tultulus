const {
  jsonResponse,
  sendPaymentNotifications,
  squareRequest,
  verifySquareWebhookSignature,
} = require("../lib/square");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  const rawBody = event.body || "";
  const signature = event.headers?.["x-square-hmacsha256-signature"]
    || event.headers?.["X-Square-HmacSha256-Signature"];
  if (!verifySquareWebhookSignature(rawBody, signature)) {
    return jsonResponse(403, { error: "Invalid webhook signature" });
  }

  let notification;
  try {
    notification = JSON.parse(rawBody);
  } catch {
    return jsonResponse(400, { error: "Invalid JSON" });
  }

  // Acknowledge unrelated events. Configure the subscription for payment.updated.
  if (notification.type !== "payment.updated") {
    return jsonResponse(200, { received: true });
  }

  const eventPayment = notification.data?.object?.payment;
  if (eventPayment?.status !== "COMPLETED" || !eventPayment.id || !eventPayment.order_id) {
    return jsonResponse(200, { received: true });
  }

  try {
    const [paymentResponse, orderResponse] = await Promise.all([
      squareRequest(`/v2/payments/${encodeURIComponent(eventPayment.id)}`),
      squareRequest(`/v2/orders/${encodeURIComponent(eventPayment.order_id)}`),
    ]);
    await sendPaymentNotifications(paymentResponse.payment, orderResponse.order);
  } catch (error) {
    // A non-2xx response asks Square to retry the webhook later.
    console.error("Square webhook processing failed", error);
    return jsonResponse(500, { error: "Webhook processing failed" });
  }

  return jsonResponse(200, { received: true });
};
