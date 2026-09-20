const {
  CheckoutError,
  cleanText,
  getSafeBankDetails,
  getSquareConfig,
  jsonResponse,
  sendAchPendingNotification,
  sendPaymentNotifications,
  squareRequest,
} = require("../lib/square");

function publicResult(payment, order) {
  const bank = getSafeBankDetails(payment);
  return {
    success: ["PENDING", "COMPLETED"].includes(payment?.status),
    pending: payment?.status === "PENDING",
    order: {
      id: order.id,
      referenceId: order.reference_id,
      lineItems: order.line_items,
      totalMoney: order.total_money,
    },
    payment: {
      id: payment.id,
      status: payment.status,
      sourceType: payment.source_type,
      receiptNumber: payment.receipt_number,
      receiptUrl: payment.receipt_url,
      amountMoney: payment.amount_money,
      bankName: bank.bankName,
      accountType: bank.accountType,
      last4: bank.last4,
      country: bank.country,
    },
  };
}

function findPaymentId(order) {
  return (order?.tenders || []).find((tender) => tender.payment_id)?.payment_id || "";
}

async function sendStatusNotification(payment, order) {
  try {
    if (payment.status === "PENDING") return await sendAchPendingNotification(payment, order);
    if (payment.status === "COMPLETED") return await sendPaymentNotifications(payment, order);
  } catch (error) {
    // Payment state is authoritative even if an email provider is temporarily down.
    // The signed webhook retries the same idempotent notification later.
    console.error("ACH payment notification failed", error);
    return { failed: 1 };
  }
  return { skipped: true };
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
    const orderId = cleanText(body.orderId, 192);
    const checkoutAttemptId = cleanText(body.checkoutAttemptId, 45);
    const expectedAmountCents = Number(body.expectedAmountCents);
    if (
      !sourceId.startsWith("bauth:")
      || sourceId.length < 12
      || !orderId
      || !/^[a-zA-Z0-9_-]{16,45}$/.test(checkoutAttemptId)
      || !Number.isSafeInteger(expectedAmountCents)
      || expectedAmountCents < 1
    ) {
      throw new CheckoutError(400, "Invalid ACH payment request.", "INVALID_ACH_REQUEST");
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
      throw new CheckoutError(409, "The verified order does not match this bank transfer.", "ORDER_MISMATCH");
    }

    const existingPaymentId = findPaymentId(order);
    if (existingPaymentId) {
      const existingResponse = await squareRequest(`/v2/payments/${encodeURIComponent(existingPaymentId)}`);
      const existing = existingResponse.payment;
      if (
        existing?.order_id !== order.id
        || existing?.location_id !== config.locationId
        || existing?.amount_money?.amount !== order.total_money.amount
        || existing?.amount_money?.currency !== "USD"
      ) {
        throw new CheckoutError(409, "The existing payment does not match this order.", "PAYMENT_MISMATCH");
      }
      if (existing?.source_type !== "BANK_ACCOUNT") {
        throw new CheckoutError(409, "This order already has a different payment method.", "PAYMENT_METHOD_CONFLICT");
      }
      if (existing?.status === "FAILED") {
        throw new CheckoutError(409, "This bank transfer failed. Please start a new checkout.", "ACH_PAYMENT_FAILED");
      }
      if (["PENDING", "COMPLETED"].includes(existing?.status)) {
        const notifications = await sendStatusNotification(existing, order);
        const result = publicResult(existing, order);
        result.notifications = notifications;
        return jsonResponse(existing.status === "PENDING" ? 202 : 200, result);
      }
    }

    const recipient = order.fulfillments?.[0]?.shipment_details?.recipient || {};
    const paymentResponse = await squareRequest("/v2/payments", {
      method: "POST",
      body: {
        source_id: sourceId,
        // A checkout attempt maps to exactly one Square ACH payment. Replayed
        // tokens or simultaneous browser requests therefore cannot double debit.
        idempotency_key: `ach-${checkoutAttemptId}`,
        amount_money: order.total_money,
        autocomplete: true,
        location_id: config.locationId,
        order_id: order.id,
        reference_id: order.reference_id,
        ...(recipient.email_address ? { buyer_email_address: recipient.email_address } : {}),
        ...(recipient.address ? { billing_address: recipient.address, shipping_address: recipient.address } : {}),
        note: `Tultulus ACH web order ${order.id}`.slice(0, 500),
      },
    });
    const payment = paymentResponse.payment;
    if (
      payment?.source_type !== "BANK_ACCOUNT"
      || payment?.order_id !== order.id
      || payment?.location_id !== config.locationId
      || payment?.amount_money?.amount !== order.total_money.amount
      || payment?.amount_money?.currency !== "USD"
      || !["PENDING", "COMPLETED"].includes(payment?.status)
    ) {
      throw new CheckoutError(409, "Square did not start the bank transfer. Your order was not confirmed.", "ACH_NOT_STARTED");
    }

    const notifications = await sendStatusNotification(payment, order);
    const result = publicResult(payment, order);
    result.notifications = notifications;
    return jsonResponse(payment.status === "PENDING" ? 202 : 200, result);
  } catch (error) {
    console.error("Square ACH checkout error", { code: error.code, message: error.message });
    return jsonResponse(error.statusCode || 500, {
      error: error.message || "Bank transfer could not be started.",
      code: error.code || "ACH_PAYMENT_ERROR",
    });
  }
};
