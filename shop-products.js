import { collection, db, getDocs } from "./firebase-config.js";

const PRODUCTS_COLLECTION = "products";
const CACHE_KEY = "day1_products_cache_v2";
const LEGACY_CACHE_KEY = "day1_products_cache";
const DETAIL_CACHE_KEY = "day1_product_details_v2";
const LEGACY_DETAIL_KEY = "day1_product_details";
const CACHE_MS = 60 * 60 * 1000; // 1 hour valid cache

const featuredGrid = document.querySelector("#featured-products .product-grid");
const allGrid = document.querySelector("#all-categories .product-grid");
const hotGrid = document.querySelector("#top-rated .product-grid");

let currentRenderedFingerprint = "";
const prefetchedProducts = new Set();
const prefetchedImages = new Set();

function toNumber(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? "").replace(/[^\d]/g, ""), 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function getTimestampValue(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") return value.seconds * 1000;
  if (typeof value === "number") return value;
  return 0;
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getCategories(data) {
  const categories = new Set(["all"]);
  const rawCategories = Array.isArray(data.categories) ? data.categories : [];
  rawCategories.forEach((item) => {
    const slug = slugify(item);
    if (slug) categories.add(slug);
  });
  if (data.featured === true || categories.has("featured")) categories.add("featured");
  if (data.hotSelling === true || categories.has("hot-selling") || categories.has("hotselling")) {
    categories.add("hot-selling");
  }
  return Array.from(categories);
}

function calculateDiscount(priceCurrent, priceOriginal) {
  if (!priceCurrent || !priceOriginal || priceOriginal <= priceCurrent) return null;
  return Math.round(((priceOriginal - priceCurrent) / priceOriginal) * 100);
}

function normalizeProduct(docSnap) {
  const data = typeof docSnap.data === "function" ? (docSnap.data() || {}) : (docSnap || {});
  const images = Array.isArray(data.images)
    ? data.images.filter(Boolean)
    : String(data.images || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
  const designPoints = Array.isArray(data.designPoints)
    ? data.designPoints.filter(Boolean)
    : String(data.designPoints || "")
        .split("|")
        .map((item) => item.trim())
        .filter(Boolean);
  const priceCurrent = toNumber(data.priceCurrent ?? data.price);
  const priceOriginal = toNumber(data.priceOriginal ?? data.offer, priceCurrent);
  const discount = calculateDiscount(priceCurrent, priceOriginal);
  const categories = getCategories(data);
  const sizes = Array.isArray(data.sizes)
    ? data.sizes.map((item) => String(item).trim()).filter(Boolean)
    : String(data.sizes || "")
        .split(/[,|\n]+/)
        .map((item) => item.trim())
        .filter(Boolean);
  const colors = Array.isArray(data.colors)
    ? data.colors.map((item) => String(item).trim()).filter(Boolean)
    : String(data.colors || "")
        .split(/[,|\n]+/)
        .map((item) => item.trim())
        .filter(Boolean);

  return {
    id: docSnap.id || data.id,
    name: String(data.name || "Unnamed product"),
    subtitle: String(data.subtitle || "Premium collection"),
    priceCurrent,
    priceOriginal,
    badge: String(data.badge || "").trim() || (discount ? `${discount}% OFF` : "NEW"),
    cotton: String(data.cotton || "add details"),
    quality: String(data.quality || "add details"),
    fabric: String(data.fabric || "add details"),
    sizeChartUrl: String(data.sizeChartUrl || data.sizechart || "photos/chart.jpeg"),
    images: images.length ? images : ["photos/any.jpeg"],
    designPoints,
    sizes,
    colors,
    sizeChart: data.sizeChart || null,
    categories,
    isPublished: data.isPublished !== false,
    sortOrder: Number.isFinite(Number(data.sortOrder)) ? Number(data.sortOrder) : 9999,
    createdAt: getTimestampValue(data.createdAt),
  };
}

function getProductsFingerprint(list) {
  if (!Array.isArray(list)) return "";
  return list
    .map(
      (p) =>
        `${p.id}:${p.name}:${p.priceCurrent}:${p.priceOriginal}:${(p.images || [])[0]}:${(p.sizes || []).join(",")}:${(p.colors || []).join(",")}:${(p.categories || []).join(",")}`,
    )
    .join("|");
}

function prefetchProductAssets(product) {
  if (!product || !product.id || prefetchedProducts.has(product.id)) return;
  prefetchedProducts.add(product.id);
  cacheProductDetail(product);

  (product.images || []).slice(0, 3).forEach((src) => {
    if (!src || prefetchedImages.has(src)) return;
    prefetchedImages.add(src);
    const img = new Image();
    img.decoding = "async";
    img.src = src;
  });
}

function createProductCard(product) {
  const primaryImage = product.images[0] || "photos/any.jpeg";
  const discount = calculateDiscount(product.priceCurrent, product.priceOriginal);
  const labelChip = product.categories.includes("featured")
    ? "Featured"
    : product.categories.includes("hot-selling")
      ? "Hot Selling"
      : "Product";

  const card = document.createElement("article");
  card.className = "product-card info-card";
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", `View ${product.name}`);

  card.dataset.id = product.id;
  card.dataset.name = product.name;
  card.dataset.price = `BDT ${product.priceCurrent}`;
  card.dataset.priceValue = `${product.priceCurrent}`;
  card.dataset.offer = `${product.priceOriginal}`;
  card.dataset.badge = product.badge;
  card.dataset.images = product.images.join(",");

  card.innerHTML = `
    <div class="product-image">
      <img src="${primaryImage}" alt="${product.name}" loading="lazy" decoding="async" onload="this.parentElement.classList.add('is-loaded')" />
      <span class="label-chip">${labelChip}</span>
      <span class="badge">${product.badge}</span>
    </div>
    <div class="mt-4 space-y-2">
      <h3 class="font-bold text-sm uppercase tracking-wider">${product.name}</h3>
      <div class="price-display">
        <span class="price-currency">BDT</span>
        <span class="price-original">${product.priceOriginal}</span>
        <span class="price-current">${product.priceCurrent}</span>
        <span class="price-badge">${discount ? `${discount}% OFF` : "NEW"}</span>
      </div>
    </div>
  `;

  // Predictive prefetch on hover/touch
  const triggerPrefetch = () => prefetchProductAssets(product);
  card.addEventListener("mouseenter", triggerPrefetch, { passive: true });
  card.addEventListener("touchstart", triggerPrefetch, { passive: true });

  const openProductPage = () => {
    cacheProductDetail(product);
    prefetchProductAssets(product);
    window.location.href = `product.html?id=${encodeURIComponent(product.id)}`;
  };
  card.addEventListener("click", openProductPage);
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openProductPage();
    }
  });

  return card;
}

function renderSkeletons(gridElement, count = 4) {
  if (!gridElement) return;
  gridElement.innerHTML = Array.from({ length: count })
    .map(
      () => `
      <div class="product-card-skeleton">
        <div class="skeleton-image"></div>
        <div class="skeleton-info">
          <div class="skeleton-line" style="width: 75%;"></div>
          <div class="skeleton-line short"></div>
        </div>
      </div>`,
    )
    .join("");
}

function renderIntoGrid(gridElement, products, emptyMessage) {
  if (!gridElement) return;
  gridElement.innerHTML = "";

  if (!products.length) {
    const emptyState = document.createElement("div");
    emptyState.className =
      "col-span-full border border-[rgba(255,255,255,0.18)] rounded-2xl p-6 text-sm tracking-wide text-center text-[var(--muted)]";
    emptyState.textContent = emptyMessage;
    gridElement.appendChild(emptyState);
    return;
  }

  products.forEach((product) => {
    gridElement.appendChild(createProductCard(product));
  });

  if (typeof window.attachImageLoaders === "function") {
    window.attachImageLoaders(gridElement);
  }
}

function renderProducts(products) {
  const featuredProducts = products.filter((product) =>
    product.categories.includes("featured"),
  );
  const hotProducts = products.filter((product) =>
    product.categories.includes("hot-selling"),
  );

  renderIntoGrid(featuredGrid, featuredProducts, "No featured products yet.");
  renderIntoGrid(allGrid, products, "No products found.");
  renderIntoGrid(hotGrid, hotProducts, "No hot selling products yet.");
}

function readCachedProducts() {
  try {
    const raw =
      localStorage.getItem(CACHE_KEY) ||
      sessionStorage.getItem(CACHE_KEY) ||
      localStorage.getItem(LEGACY_CACHE_KEY) ||
      sessionStorage.getItem(LEGACY_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.products || Date.now() - (parsed.ts || 0) > CACHE_MS) return null;
    return parsed.products;
  } catch {
    return null;
  }
}

function writeCachedProducts(products) {
  try {
    const payload = JSON.stringify({ ts: Date.now(), products });
    localStorage.setItem(CACHE_KEY, payload);
    sessionStorage.setItem(CACHE_KEY, payload);

    const details = {};
    products.forEach((product) => {
      details[product.id] = product;
    });
    const detailsPayload = JSON.stringify({ ts: Date.now(), details });
    localStorage.setItem(DETAIL_CACHE_KEY, detailsPayload);
    sessionStorage.setItem(DETAIL_CACHE_KEY, detailsPayload);
  } catch {
    // Ignore quota / private mode.
  }
}

function cacheProductDetail(product) {
  if (!product?.id) return;
  try {
    const raw =
      localStorage.getItem(DETAIL_CACHE_KEY) ||
      sessionStorage.getItem(DETAIL_CACHE_KEY) ||
      "{}";
    const parsed = JSON.parse(raw);
    const details = parsed.details && typeof parsed.details === "object" ? parsed.details : {};
    details[product.id] = product;
    const detailsPayload = JSON.stringify({ ts: Date.now(), details });
    localStorage.setItem(DETAIL_CACHE_KEY, detailsPayload);
    sessionStorage.setItem(DETAIL_CACHE_KEY, detailsPayload);
  } catch {
    // Ignore quota / private mode.
  }
}

async function loadProducts() {
  if (!featuredGrid && !allGrid && !hotGrid) {
    document.documentElement.classList.remove("firebase-products-loading");
    return;
  }

  // 1. Instant Synchronous Cache Render (0ms perceived load)
  const cached = readCachedProducts();
  if (cached?.length) {
    document.documentElement.classList.remove("firebase-products-loading");
    currentRenderedFingerprint = getProductsFingerprint(cached);
    renderProducts(cached);
  } else {
    renderSkeletons(featuredGrid, 4);
    renderSkeletons(allGrid, 8);
    renderSkeletons(hotGrid, 4);
  }

  // 2. Background Silent Revalidation from Firestore
  try {
    const snapshot = await getDocs(collection(db, PRODUCTS_COLLECTION));
    const products = snapshot.docs
      .map((doc) => normalizeProduct({ id: doc.id, ...doc.data() }))
      .filter((product) => product.isPublished)
      .sort((left, right) => {
        if (left.sortOrder !== right.sortOrder) {
          return left.sortOrder - right.sortOrder;
        }
        return right.createdAt - left.createdAt;
      });

    writeCachedProducts(products);
    document.documentElement.classList.remove("firebase-products-loading");

    const newFingerprint = getProductsFingerprint(products);
    // ONLY re-render if there is an actual change in products! (Prevents vanishing/flickering)
    if (newFingerprint !== currentRenderedFingerprint) {
      currentRenderedFingerprint = newFingerprint;
      renderProducts(products);
    }
  } catch (error) {
    console.error("Failed to load products from Firebase", error);
    if (!cached || !cached.length) {
      renderIntoGrid(featuredGrid, [], "Unable to load products. Please check your connection.");
      renderIntoGrid(allGrid, [], "Unable to load products. Please check your connection.");
      renderIntoGrid(hotGrid, [], "Unable to load products. Please check your connection.");
    }
  }
}

loadProducts();
