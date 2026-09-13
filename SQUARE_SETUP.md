# Square payment setup

The checkout is implemented for a US Square seller charging US buyers in USD. It accepts debit and credit cards supported by the seller's Square account, including Mastercard.

## 1. Create the Square application

1. Sign in to the [Square Developer Console](https://developer.squareup.com/apps).
2. Create or select the Tultulus application.
3. Start with **Sandbox** credentials.
4. Copy the Sandbox Application ID, Access Token, and Location ID into the matching Netlify environment variables below.

## 2. Add Netlify environment variables

Add these under **Netlify → Site configuration → Environment variables**. Do not put live values in source control.

```text
SQUARE_ENVIRONMENT=sandbox
SQUARE_APPLICATION_ID=...
SQUARE_LOCATION_ID=...
SQUARE_ACCESS_TOKEN=...
SQUARE_SHIPPING_FEE_CENTS=700
SQUARE_FREE_SHIPPING_THRESHOLD_CENTS=15000
FIREBASE_PROJECT_ID=tultulus
FIREBASE_WEB_API_KEY=...
PROMO_CODE=Ethika05
PROMO_DISCOUNT_PERCENT=5
```

`SQUARE_SHIPPING_FEE_CENTS` is the flat shipping fee in cents. Set it to `700` for a $7.00 fee. Product subtotal of $150.00 or more automatically receives free shipping; the fee is calculated server-side, before any promo discount.

The Application ID and Location ID are safe for the browser. The Access Token is secret and is read only by Netlify Functions.

## 2a. Enable wallet payment methods

Mastercard is already accepted through the existing debit/credit card field. Apple Pay and Google Pay use the same Square application, location, server-side order, and payment endpoint, so they do not need extra Netlify secrets.

Before enabling them for customers:

1. In Square Developer Console **Production**, open **Apple Pay** and register `tultulus.com`. Complete Square's domain-verification flow. Apple Pay only appears on an eligible Apple device/browser over HTTPS.
2. Complete Google's production enablement for Google Pay using Square as the payment gateway, then test with an eligible wallet/browser over HTTPS.
3. Deploy, then test Apple Pay on Safari and Google Pay on a device/browser with an eligible wallet. Unsupported devices simply show the normal card form.

Zelle is not a Square Web Payments SDK method. Do not show it as a payment button unless a separate Zelle business payment workflow, confirmation process, and fraud/reconciliation rules are implemented.

## 3. Configure the payment webhook

In the Square Developer Console, open the application's **Webhooks** section and add:

```text
https://YOUR-DOMAIN/.netlify/functions/square-webhook
```

Subscribe to `payment.updated`, then copy the webhook Signature Key into Netlify:

```text
SQUARE_WEBHOOK_SIGNATURE_KEY=...
SQUARE_WEBHOOK_NOTIFICATION_URL=https://YOUR-DOMAIN/.netlify/functions/square-webhook
```

The notification URL must match exactly, including `https`, path, and trailing slash choice. The function rejects notifications whose Square HMAC signature is invalid.

## 4. Configure buyer and seller emails

Square payments and receipts work without an email provider, but automatic Tultulus emails need a verified [Resend](https://resend.com/) sending domain:

```text
RESEND_API_KEY=...
RESEND_FROM_EMAIL=Tultulus <orders@YOUR-DOMAIN>
SELLER_NOTIFICATION_EMAIL=SELLER@EXAMPLE.COM
```

After a verified completed payment, the buyer and seller receive order details and the official Square receipt link. Resend idempotency keys prevent duplicate emails when a webhook is retried.

## 5. Test and go live

1. Deploy with Sandbox credentials.
2. Add a current product to the cart again so the cart contains its Firestore product ID.
3. Test successful, declined, invalid ZIP/CVV, repeated-click, and interrupted-network cases with [Square Sandbox test cards](https://developer.squareup.com/docs/devtools/sandbox/payments).
4. Confirm the paid shipment order appears in the Sandbox Square Dashboard and both emails arrive.
5. Replace the Application ID, Location ID, and Access Token together with their Production values.
6. Set `SQUARE_ENVIRONMENT=production`, configure a Production webhook subscription/signature key, and redeploy.
7. Make one small real-card purchase and refund it from Square Dashboard before opening checkout to customers.

Never mix Sandbox and Production credentials, and never expose `SQUARE_ACCESS_TOKEN`, `SQUARE_WEBHOOK_SIGNATURE_KEY`, or `RESEND_API_KEY` in HTML or client-side JavaScript.
