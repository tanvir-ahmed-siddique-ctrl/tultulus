# Day-1 Admin + Firebase + Netlify + Cloudinary Setup

This file is the repeat of the previous Accolade launch, but for the **new brand**. Do not reuse the old Accolade Firebase project, Cloudinary folder, Netlify site, or admin email.

`ADMIN_SETUP.md` is the live checklist. Follow it in order.

## 0) What you are creating (new, not copied)

| Service | Create a **new** one |
| --- | --- |
| Firebase project | New project (suggested id: `day-1-store` or similar) |
| Firebase Auth | Email/Password, **new admin email** |
| Firestore | New database, **Asia region** |
| Cloudinary | New cloud **or** new folder `day1/products` |
| Netlify site | New site, then attach `tultulus.co` / `day-1.com` |
| FormSubmit | Orders already go to `support@day-1.com` in `shop.html` |

## 1) Firebase project

1. Open [Firebase Console](https://console.firebase.google.com/) → **Add project**.
2. Skip Google Analytics if you want (optional).
3. Project settings (gear) → **Your apps** → **Web** (`</>`) → register app name `Day-1`.
4. Copy the `firebaseConfig` object.
5. Put **only** the web `apiKey` in Netlify as `FIREBASE_WEB_API_KEY` (and in local `.env`). Do not paste live keys or admin UIDs into repo files.

### Authentication (admin only)

1. Build → Authentication → **Get started**.
2. Sign-in method → enable **Email/Password**.
3. Users → **Add user** with the **new admin email + password** (not the Accolade one).
4. Open that user and copy the **UID**. You need it for Firestore rules and Netlify. Keep it in Netlify env vars only — do not paste the live UID into this file.

### Firestore (important for shop loading)

The old shop waited 2–4 seconds because the catalog was fetched from a far-away Firestore region (often `us-central1`) and the page hid products until **every** document returned.

For this brand:

1. Build → Firestore Database → **Create database**.
2. Start in **production mode**.
3. Choose region **`asia-south1` (Mumbai)** or **`asia-southeast1` (Singapore)** — not United States. Region cannot be changed later.
4. Publish these rules (replace `YOUR_ADMIN_UID`):

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /products/{productId} {
      allow read: if true;
      allow write: if request.auth != null && request.auth.uid == "YOUR_ADMIN_UID";
    }
  }
}
```

If you have two admins, use:

```js
allow write: if request.auth != null && request.auth.uid in ["UID_1", "UID_2"];
```

Shop loading is also improved in code: the last product list is cached in the browser so the second visit shows products immediately, then refreshes from Firebase.

## 2) Cloudinary (product photos)

1. Sign up / log in at [Cloudinary](https://cloudinary.com/).
2. Dashboard → copy **Cloud name**, **API Key**, **API Secret**.
3. Uploads from admin go to folder `day1/products` (already set in code).
4. You do **not** put the API secret in frontend files. Netlify stores it.

## 3) Deploy with Netlify

### Option A — Git (recommended)

1. Push this folder to a **new** GitHub repo (do not overwrite Accolade).
2. Netlify → **Add new site** → Import from Git.
3. Publish directory: leave empty / site root (this is a static site).
4. Functions folder is already `netlify/functions` via `netlify.toml`.

### Option B — Drag and drop

1. Zip the project.
2. Keep these in the upload:
   - `index.html`, `shop.html`, `product.html`, `about.html`, `contact.html`, `admin.html`
   - `admin.js`, `product.js`, `shop-products.js`, `firebase-config.js`, `nav-cart.js`
   - `netlify.toml`
   - `netlify/functions/cloudinary-signature.js`
   - `photos/`, `favicon.ico`, and other static assets
3. Open the Netlify URL and check `/shop.html` and `/admin.html`.

## 4) Custom domain (Netlify + your registrar)

In Netlify:

- Site settings → Domain management → **Add custom domain** (e.g. `tultulus.co` or `day-1.com`)

At the domain registrar (Hostinger or wherever the domain lives):

- A record `@` → `75.2.60.5`
- A record `@` → `99.83.190.102`
- CNAME `www` → `your-site-name.netlify.app`

Then in Netlify:

- Verify DNS
- Enable HTTPS
- Set the preferred primary domain

## 5) Firebase authorized domains (required for admin login)

Authentication → Settings → Authorized domains. Add:

- `localhost`
- `your-site-name.netlify.app`
- `yourdomain.com`
- `www.yourdomain.com`

Without this, admin login fails on the live domain.

## 6) Netlify environment variables (secrets)

Site settings → Environment variables:

- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`
- `FIREBASE_WEB_API_KEY`
- `ALLOWED_ADMIN_UIDS`

These values stay in Netlify only. Do not paste them into `ADMIN_SETUP.md`, `firebase-config.js`, or any other git file.

Redeploy after saving variables. The build copies `FIREBASE_WEB_API_KEY` into the live site automatically. Cloudinary secret is used only by the Netlify function.

Local `.env` is gitignored. Copy `.env.example` → `.env`, then run `node scripts/write-firebase-config.js` if you need to test locally.

## 7) FormSubmit (order emails)

Checkout posts to `https://formsubmit.co/support@day-1.com`.

The first live order email may ask you to **confirm the inbox**. Open `support@day-1.com` and click the FormSubmit confirmation link once.

Each order email includes order number, payment method, items, and billing details. The customer also sees a full receipt on screen — ask them to screenshot it.

## 8) Admin usage

- Open `admin.html`
- Sign in with the **new** admin email/password
- Step 1: card info
- Step 2: sizes (`S, M, L, XL` or numbers like `28, 24.2`) and the size chart (Add column / Add row)
- Step 3: upload photos
- Step 4: publish
- **Save product** → it appears on `shop.html`

## 9) Quick go-live checklist

- [ ] New Firebase project + `FIREBASE_WEB_API_KEY` only in Netlify / `.env`
- [ ] Firestore in `asia-south1` or `asia-southeast1`
- [ ] New admin user + UID in rules and `ALLOWED_ADMIN_UIDS`
- [ ] Cloudinary vars on Netlify
- [ ] Authorized domains include Netlify + custom domain
- [ ] HTTPS on custom domain
- [ ] FormSubmit confirmed for `support@day-1.com`
- [ ] Test: admin login, upload image, save product, shop load, checkout COD, checkout bank transfer
