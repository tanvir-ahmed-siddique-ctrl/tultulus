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
SQUARE_SHIPPING_FEE_CENTS=0
FIREBASE_PROJECT_ID=tultulus
FIREBASE_WEB_API_KEY=...
PROMO_CODE=Ethika05
PROMO_DISCOUNT_PERCENT=5
```

`SQUARE_SHIPPING_FEE_CENTS` is the flat US shipping fee in cents. For example, `$8.00` is `800`. Keep it at `0` for free shipping.

The Application ID and Location ID are safe for the browser. The Access Token is secret and is read only by Netlify Functions.

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
