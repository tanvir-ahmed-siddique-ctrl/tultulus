const {
  CheckoutError,
  cleanText,
  getSquareConfig,
  jsonResponse,
  sendPaymentNotifications,
  squareRequest,
} = require("../lib/square");

function publicResult(payment, order) {
  return {
    success: payment?.status === "COMPLETED",
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
      cardBrand: payment.card_details?.card?.card_brand || "Card",
      last4: payment.card_details?.card?.last_4 || "",
    },
  };
}

function findPaymentId(order) {
  return (order?.tenders || []).find((tender) => tender.payment_id)?.payment_id || "";
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  try {
    const config = getSquareConfig({ requireSecret: true });
    if (!event.body || Buffer.byteLength(event.body, "utf8") > 20_000) {
      throw new CheckoutError(400, "Invalid checkout request.", "INVALID_REQUEST");
    }
    let body;
    try {
      body = JSON.parse(event.body);
    } catch {
      throw new CheckoutError(400, "Invalid checkout request.", "INVALID_JSON");
    }

    const sourceId = cleanText(body.sourceId, 512);
    const verificationToken = cleanText(body.verificationToken, 512);
    const orderId = cleanText(body.orderId, 192);
    const checkoutAttemptId = cleanText(body.checkoutAttemptId, 45);
    const expectedAmountCents = Number(body.expectedAmountCents);
    if (
      !sourceId
      || !orderId
      || !/^[a-zA-Z0-9_-]{16,45}$/.test(checkoutAttemptId)
      || !Number.isSafeInteger(expectedAmountCents)
    ) {
      throw new CheckoutError(400, "Invalid payment request.", "INVALID_PAYMENT_REQUEST");
    }

    const orderResponse = await squareRequest(`/v2/orders/${encodeURIComponent(orderId)}`);
    const order = orderResponse.order;
    const expectedReference = `TULT-${checkoutAttemptId}`.slice(0, 40);
    if (
      !order
      || order.location_id !== config.locationId
      || order.reference_id !== expectedReference
      || order.total_money?.amount !== expectedAmountCents
      || order.total_money?.currency !== "USD"
    ) {
      throw new CheckoutError(409, "The verified order does not match this payment attempt.", "ORDER_MISMATCH");
    }

    const existingPaymentId = findPaymentId(order);
    if (existingPaymentId) {
      const existingResponse = await squareRequest(`/v2/payments/${encodeURIComponent(existingPaymentId)}`);
      if (existingResponse.payment?.status === "COMPLETED") {
        await sendPaymentNotifications(existingResponse.payment, order);
        return jsonResponse(200, publicResult(existingResponse.payment, order));
      }
    }

    const recipient = order.fulfillments?.[0]?.shipment_details?.recipient || {};
    const paymentResponse = await squareRequest("/v2/payments", {
      method: "POST",
      body: {
        source_id: sourceId,
        ...(verificationToken ? { verification_token: verificationToken } : {}),
        // The server owns payment idempotency. Replays or simultaneous requests for
        // one checkout attempt can therefore create at most one Square payment.
        idempotency_key: `pay-${checkoutAttemptId}`,
        amount_money: order.total_money,
        autocomplete: true,
        location_id: config.locationId,
        order_id: order.id,
        reference_id: order.reference_id,
        ...(recipient.email_address ? { buyer_email_address: recipient.email_address } : {}),
        ...(recipient.address ? { billing_address: recipient.address, shipping_address: recipient.address } : {}),
        note: `Tultulus web order ${order.id}`.slice(0, 500),
      },
    });
    const payment = paymentResponse.payment;
    if (payment?.status !== "COMPLETED") {
      throw new CheckoutError(409, "The payment was not completed. Your order has not been confirmed.", "PAYMENT_NOT_COMPLETED");
    }

    let notifications = { skipped: true };
    try {
      notifications = await sendPaymentNotifications(payment, order);
    } catch (notificationError) {
      console.error("Payment completed but notification failed", notificationError);
      notifications = { failed: 1 };
    }
    const result = publicResult(payment, order);
    result.notifications = notifications;
    return jsonResponse(200, result);
  } catch (error) {
    console.error("Square checkout error", { code: error.code, message: error.message });
    return jsonResponse(error.statusCode || 500, {
      error: error.message || "Payment could not be processed.",
      code: error.code || "PAYMENT_ERROR",
    });
  }
};
