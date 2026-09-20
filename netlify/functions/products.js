const crypto = require("crypto");

const DEFAULT_FIREBASE_PROJECT_ID = "tultulus";
const MAX_PAGES = 10;

function jsonResponse(statusCode, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=30, stale-while-revalidate=300",
      "Netlify-CDN-Cache-Control": "public, durable, s-maxage=30, stale-while-revalidate=300",
      "CDN-Cache-Control": "public, s-maxage=30, stale-while-revalidate=300",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
    body,
  };
}

function decodeFirestoreValue(value) {
  if (!value || typeof value !== "object") return null;
  if (Object.prototype.hasOwnProperty.call(value, "nullValue")) return null;
  if (Object.prototype.hasOwnProperty.call(value, "stringValue")) return value.stringValue;
  if (Object.prototype.hasOwnProperty.call(value, "booleanValue")) return value.booleanValue;
  if (Object.prototype.hasOwnProperty.call(value, "integerValue")) return Number(value.integerValue);
  if (Object.prototype.hasOwnProperty.call(value, "doubleValue")) return Number(value.doubleValue);
  if (Object.prototype.hasOwnProperty.call(value, "timestampValue")) return Date.parse(value.timestampValue) || 0;
  if (value.arrayValue) return (value.arrayValue.values || []).map(decodeFirestoreValue);
  if (value.mapValue) {
    return Object.fromEntries(
      Object.entries(value.mapValue.fields || {}).map(([key, nested]) => [key, decodeFirestoreValue(nested)]),
    );
  }
  return null;
}

function decodeDocument(document) {
  const id = String(document.name || "").split("/").pop();
  return {
    id,
    ...Object.fromEntries(
      Object.entries(document.fields || {}).map(([key, value]) => [key, decodeFirestoreValue(value)]),
    ),
  };
}

async function fetchPublishedProducts() {
  const projectId = String(process.env.FIREBASE_PROJECT_ID || DEFAULT_FIREBASE_PROJECT_ID).trim();
  const apiKey = String(process.env.FIREBASE_WEB_API_KEY || "").trim();
  const baseUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/products`;
  const products = [];
  let pageToken = "";

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const params = new URLSearchParams({ pageSize: "100" });
    if (apiKey) params.set("key", apiKey);
    if (pageToken) params.set("pageToken", pageToken);
    const response = await fetch(`${baseUrl}?${params}`, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Firestore catalog request failed (${response.status})`);
    const payload = await response.json();
    products.push(
      ...(payload.documents || [])
        .map(decodeDocument)
        .filter((product) => product.id !== "__checkout_settings__" && product.isPublished !== false),
    );
    pageToken = payload.nextPageToken || "";
    if (!pageToken) break;
  }
  return products;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return jsonResponse(405, { error: "Method not allowed" });
  try {
    const products = await fetchPublishedProducts();
    const etag = `"${crypto.createHash("sha1").update(JSON.stringify(products)).digest("hex")}"`;
    if (event.headers?.["if-none-match"] === etag) {
      return { statusCode: 304, headers: { ETag: etag, "Netlify-CDN-Cache-Control": "public, durable, s-maxage=300, stale-while-revalidate=86400" }, body: "" };
    }
    return jsonResponse(200, { products }, { ETag: etag });
  } catch (error) {
    console.error("Catalog load failed", error);
    return jsonResponse(502, { error: "Product catalog is temporarily unavailable." }, { "Cache-Control": "no-store" });
  }
};
