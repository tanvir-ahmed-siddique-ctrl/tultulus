const RATE_CACHE_MS = 12 * 60 * 60 * 1000;
const ALLOWED_CURRENCY = /^[A-Z]{3}$/;
const rateCache = new Map();

function response(statusCode, body, cacheControl = "public, max-age=3600, stale-while-revalidate=43200") {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": cacheControl,
      "X-Content-Type-Options": "nosniff",
    },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return response(405, { error: "Method not allowed" }, "no-store");
  const currency = String(event.queryStringParameters?.currency || "USD").trim().toUpperCase();
  if (!ALLOWED_CURRENCY.test(currency)) return response(400, { error: "Invalid currency" }, "no-store");
  if (currency === "USD") return response(200, { currency: "USD", rate: 1, updatedAt: new Date().toISOString() });

  const cached = rateCache.get(currency);
  if (cached && Date.now() - cached.cachedAt < RATE_CACHE_MS) return response(200, cached.value);

  try {
    const upstream = await fetch(`https://api.frankfurter.dev/v2/rate/usd/${currency.toLowerCase()}`, {
      headers: { Accept: "application/json" },
    });
    const data = await upstream.json().catch(() => ({}));
    const rate = Number(data.rate);
    if (!upstream.ok || !Number.isFinite(rate) || rate <= 0) throw new Error("Rate unavailable");
    const value = { currency, rate, updatedAt: data.date || new Date().toISOString() };
    rateCache.set(currency, { value, cachedAt: Date.now() });
    return response(200, value);
  } catch (error) {
    return response(503, { error: "Local price estimate is temporarily unavailable" }, "no-store");
  }
};
