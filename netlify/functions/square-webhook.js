const {
  getSquareConfig,
  jsonResponse,
  sendAchFailedNotifications,
  sendAchPendingNotification,
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
  if (
    !["PENDING", "COMPLETED", "FAILED"].includes(eventPayment?.status)
    || !eventPayment.id
    || !eventPayment.order_id
  ) {
    return jsonResponse(200, { received: true });
  }

  try {
    const [paymentResponse, orderResponse] = await Promise.all([
      squareRequest(`/v2/payments/${encodeURIComponent(eventPayment.id)}`),
      squareRequest(`/v2/orders/${encodeURIComponent(eventPayment.order_id)}`),
    ]);
    const payment = paymentResponse.payment;
    const order = orderResponse.order;
    const config = getSquareConfig({ requireSecret: true });
    if (
      payment?.order_id !== order?.id
      || payment?.location_id !== config.locationId
      || order?.location_id !== config.locationId
      || !String(order?.reference_id || "").startsWith("TULT-")
      || payment?.amount_money?.amount !== order?.total_money?.amount
      || payment?.amount_money?.currency !== "USD"
    ) {
      console.error("Ignoring webhook payment that does not match a verified Tultulus order");
      return jsonResponse(200, { received: true });
    }
    if (["COMPLETED", "FAILED"].includes(eventPayment.status) && payment?.status !== eventPayment.status) {
      throw new Error("Square payment state is not consistent yet; retrying webhook.");
    }
    if (payment?.status === "PENDING" && payment?.source_type === "BANK_ACCOUNT") {
      await sendAchPendingNotification(payment, order);
    } else if (payment?.status === "COMPLETED") {
      await sendPaymentNotifications(payment, order);
    } else if (payment?.status === "FAILED" && payment?.source_type === "BANK_ACCOUNT") {
      await sendAchFailedNotifications(payment, order);
    }
  } catch (error) {
    // A non-2xx response asks Square to retry the webhook later.
    console.error("Square webhook processing failed", error);
    return jsonResponse(500, { error: "Webhook processing failed" });
  }

  return jsonResponse(200, { received: true });
};
