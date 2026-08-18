import { collection, db, getDocs } from "./firebase-config.js";

const PRODUCTS_COLLECTION = "products";
const CACHE_KEY = "day1_products_cache";
const CACHE_MS = 10 * 60 * 1000;

document.documentElement.classList.add("firebase-products-loading");

const featuredGrid = document.querySelector("#featured-products .product-grid");
const allGrid = document.querySelector("#all-categories .product-grid");
const hotGrid = document.querySelector("#top-rated .product-grid");

function toNumber(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? "").replace(/[^\d]/g, ""), 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function getTimestampValue(value) {
  if (!value) {
    return 0;
  }
  if (typeof value.toMillis === "function") {
    return value.toMillis();
  }
  if (typeof value.seconds === "number") {
    return value.seconds * 1000;
  }
  if (typeof value === "number") {
    return value;
  }
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
    if (slug) {
      categories.add(slug);
    }
  });
  if (data.featured === true || categories.has("featured")) {
    categories.add("featured");
  }
  if (
    data.hotSelling === true ||
    categories.has("hot-selling") ||
    categories.has("hotselling")
  ) {
    categories.add("hot-selling");
  }
  return Array.from(categories);
}

function calculateDiscount(priceCurrent, priceOriginal) {
  if (!priceCurrent || !priceOriginal || priceOriginal <= priceCurrent) {
    return null;
  }
  return Math.round(((priceOriginal - priceCurrent) / priceOriginal) * 100);
}

function normalizeProduct(docSnap) {
  const data = docSnap.data() || {};
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

  return {
    id: docSnap.id,
    name: String(data.name || "Unnamed product"),
    subtitle: String(data.subtitle || "Premium collection"),
    priceCurrent,
    priceOriginal,
    badge:
      String(data.badge || "").trim() || (discount ? `${discount}% OFF` : "NEW"),
    cotton: String(data.cotton || "add details"),
    quality: String(data.quality || "add details"),
    fabric: String(data.fabric || "add details"),
    sizeChartUrl: String(data.sizeChartUrl || data.sizechart || "photos/chart.jpeg"),
    images,
    designPoints,
    categories,
    isPublished: data.isPublished !== false,
    sortOrder: Number.isFinite(Number(data.sortOrder))
      ? Number(data.sortOrder)
      : 9999,
    createdAt: getTimestampValue(data.createdAt),
  };
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
  card.dataset.subtitle = product.subtitle;
  card.dataset.price = `BDT ${product.priceCurrent}`;
  card.dataset.priceValue = `${product.priceCurrent}`;
  card.dataset.offer = `${product.priceOriginal}`;
  card.dataset.badge = product.badge;
  card.dataset.cotton = product.cotton;
  card.dataset.quality = product.quality;
  card.dataset.fabric = product.fabric;
  card.dataset.design = product.designPoints.join("|");
  card.dataset.sizechart = product.sizeChartUrl;
  card.dataset.images = product.images.join(",");

  card.innerHTML = `
    <div class="product-image">
      <img src="${primaryImage}" alt="${product.name}" loading="lazy" />
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

  const openProductPage = () => {
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

function renderIntoGrid(gridElement, products, emptyMessage) {
  if (!gridElement) {
    return;
  }
  gridElement.innerHTML = "";

  if (!products.length) {
    const emptyState = document.createElement("div");
    emptyState.className =
      "col-span-full border border-[rgba(255,255,255,0.18)] rounded-2xl p-6 text-sm tracking-wide";
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
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.products || Date.now() - parsed.ts > CACHE_MS) return null;
    return parsed.products;
  } catch {
    return null;
  }
}

function writeCachedProducts(products) {
  try {
    sessionStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ ts: Date.now(), products }),
    );
  } catch {
    // Ignore quota / private mode.
  }
}

async function loadProducts() {
  if (!featuredGrid && !allGrid && !hotGrid) {
    document.documentElement.classList.remove("firebase-products-loading");
    return;
  }

  const cached = readCachedProducts();
  if (cached?.length) {
    renderProducts(cached);
    document.documentElement.classList.remove("firebase-products-loading");
  } else {
    renderIntoGrid(featuredGrid, [], "Loading featured products...");
    renderIntoGrid(allGrid, [], "Loading products...");
    renderIntoGrid(hotGrid, [], "Loading hot selling products...");
  }

  try {
    const snapshot = await getDocs(collection(db, PRODUCTS_COLLECTION));
    const products = snapshot.docs
      .map(normalizeProduct)
      .filter((product) => product.isPublished)
      .sort((left, right) => {
        if (left.sortOrder !== right.sortOrder) {
          return left.sortOrder - right.sortOrder;
        }
        return right.createdAt - left.createdAt;
      });
    writeCachedProducts(products);
    renderProducts(products);
  } catch (error) {
    console.error("Failed to load Firestore products", error);
    if (!cached?.length) {
      renderIntoGrid(
        featuredGrid,
        [],
        "Could not load products from Firebase. Check Firestore rules.",
      );
      renderIntoGrid(
        allGrid,
        [],
        "Could not load products from Firebase. Check Firestore rules.",
      );
      renderIntoGrid(
        hotGrid,
        [],
        "Could not load products from Firebase. Check Firestore rules.",
      );
    }
  } finally {
    document.documentElement.classList.remove("firebase-products-loading");
  }
}

loadProducts();
