const {
  CheckoutError,
  cleanText,
  getSafeBankDetails,
  getSquareConfig,
  jsonResponse,
  sendAchFailedNotifications,
  sendAchPendingNotification,
  sendPaymentNotifications,
  squareRequest,
} = require("../lib/square");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return jsonResponse(405, { error: "Method not allowed" });
  try {
    const config = getSquareConfig({ requireSecret: true });
    const body = JSON.parse(event.body || "{}");
    const orderId = cleanText(body.orderId, 192);
    const checkoutAttemptId = cleanText(body.checkoutAttemptId, 45);
    if (!orderId || !/^[a-zA-Z0-9_-]{16,45}$/.test(checkoutAttemptId)) {
      throw new CheckoutError(400, "Invalid payment status request.", "INVALID_STATUS_REQUEST");
    }
    const orderResponse = await squareRequest(`/v2/orders/${encodeURIComponent(orderId)}`);
    const order = orderResponse.order;
    if (
      order?.location_id !== config.locationId
      || order?.reference_id !== `TULT-${checkoutAttemptId}`.slice(0, 40)
    ) {
      throw new CheckoutError(404, "Payment attempt not found.", "PAYMENT_NOT_FOUND");
    }
    const paymentId = (order.tenders || []).find((tender) => tender.payment_id)?.payment_id;
    if (!paymentId) return jsonResponse(200, { success: false, status: "PENDING" });
    const paymentResponse = await squareRequest(`/v2/payments/${encodeURIComponent(paymentId)}`);
    const payment = paymentResponse.payment;
    if (
      payment?.order_id !== order.id
      || payment?.location_id !== config.locationId
      || payment?.amount_money?.amount !== order.total_money?.amount
      || payment?.amount_money?.currency !== "USD"
    ) {
      throw new CheckoutError(404, "Payment attempt not found.", "PAYMENT_NOT_FOUND");
    }
    if (payment?.status === "FAILED" && payment?.source_type === "BANK_ACCOUNT") {
      try {
        await sendAchFailedNotifications(payment, order);
      } catch (notificationError) {
        console.error("Recovered failed ACH payment but notification failed", notificationError);
      }
      return jsonResponse(200, { success: false, status: "FAILED" });
    }
    if (!["PENDING", "COMPLETED"].includes(payment?.status)) {
      return jsonResponse(200, { success: false, status: payment?.status || "PENDING" });
    }
    try {
      if (payment.status === "PENDING" && payment.source_type === "BANK_ACCOUNT") {
        await sendAchPendingNotification(payment, order);
      } else if (payment.status === "COMPLETED") {
        await sendPaymentNotifications(payment, order);
      }
    } catch (notificationError) {
      console.error("Recovered payment but notification failed", notificationError);
    }
    const bank = payment.source_type === "BANK_ACCOUNT" ? getSafeBankDetails(payment) : null;
    return jsonResponse(200, {
      success: true,
      pending: payment.status === "PENDING",
      order: {
        id: order.id,
        referenceId: order.reference_id,
        lineItems: order.line_items,
        totalMoney: order.total_money,
      },
      payment: {
        id: payment.id,
        status: payment.status,
        receiptNumber: payment.receipt_number,
        receiptUrl: payment.receipt_url,
        amountMoney: payment.amount_money,
        sourceType: payment.source_type,
        cardBrand: payment.card_details?.card?.card_brand || (bank ? "ACH bank account" : "Card"),
        last4: payment.card_details?.card?.last_4 || "",
        ...(bank ? {
          bankName: bank.bankName,
          accountType: bank.accountType,
          last4: bank.last4,
          country: bank.country,
        } : {}),
      },
    });
  } catch (error) {
    return jsonResponse(error.statusCode || 500, {
      error: error.message || "Could not check payment status.",
      code: error.code || "STATUS_ERROR",
    });
  }
};
