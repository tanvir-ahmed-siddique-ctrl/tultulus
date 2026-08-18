import { db, doc, getDoc } from "./firebase-config.js";

const PRODUCTS_COLLECTION = "products";
const CART_KEY = "store_cart";
const LEGACY_CART_KEY = "accolade_cart";
const LIST_CACHE_KEY = "day1_products_cache";
const DETAIL_CACHE_KEY = "day1_product_details";
const CACHE_MS = 10 * 60 * 1000;
const DEFAULT_SIZES = ["S", "M", "L", "XL"];
const DEFAULT_SIZE_CHART = {
  columns: ["Length", "Chest", "Sleeve"],
  rows: [
    { label: "S", values: ['68 cm (26.8")', '55 cm (21.7")', '26 cm (10.2")'] },
    { label: "M", values: ['70 cm (27.6")', '57 cm (22.4")', '27 cm (10.6")'] },
    { label: "L", values: ['72 cm (28.3")', '59 cm (23.2")', '28 cm (11.0")'] },
    { label: "XL", values: ['74 cm (29.1")', '61 cm (24.0")', '29 cm (11.4")'] },
  ],
};

const params = new URLSearchParams(window.location.search);
const productId = params.get("id");

const els = {
  status: document.getElementById("product-status"),
  page: document.getElementById("product-page"),
  track: document.getElementById("pd-track"),
  thumbs: document.getElementById("pd-thumbs"),
  title: document.getElementById("pd-title"),
  offer: document.getElementById("pd-offer"),
  price: document.getElementById("pd-price"),
  badge: document.getElementById("pd-badge"),
  unit: document.getElementById("pd-unit"),
  sizeOptions: document.getElementById("pd-size-options"),
  sizeHint: document.getElementById("pd-size-hint"),
  chartHead: document.getElementById("pd-chart-head"),
  chartBody: document.getElementById("pd-chart-body"),
  qtyValue: document.getElementById("pd-qty-value"),
  qtyMinus: document.getElementById("pd-qty-minus"),
  qtyPlus: document.getElementById("pd-qty-plus"),
  addBtn: document.getElementById("pd-add"),
  buyBtn: document.getElementById("pd-buy"),
  zoomBtn: document.getElementById("pd-zoom-btn"),
  prev: document.querySelector("[data-pd-prev]"),
  next: document.querySelector("[data-pd-next]"),
  toast: document.getElementById("toast"),
  cartBadge: document.getElementById("cart-badge"),
  cartButton: document.getElementById("cart-button"),
  lightbox: document.getElementById("img-lightbox"),
  lbClose: document.getElementById("lb-close"),
};

let product = null;
let quantity = 1;
let selectedSize = "";
let slideIndex = 0;
let slidesCount = 0;
let unitPrice = 0;
let toastTimer = null;

function toNumber(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? "").replace(/[^\d]/g, ""), 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function calculateDiscount(priceCurrent, priceOriginal) {
  if (!priceCurrent || !priceOriginal || priceOriginal <= priceCurrent) {
    return null;
  }
  return Math.round(((priceOriginal - priceCurrent) / priceOriginal) * 100);
}

function normalizeSizeChart(raw) {
  if (raw && Array.isArray(raw.columns) && Array.isArray(raw.rows)) {
    const columns = raw.columns.map((item) => String(item || "").trim()).filter(Boolean);
    const rows = raw.rows
      .map((row) => ({
        label: String(row.label || row.size || "").trim(),
        values: Array.isArray(row.values) ? row.values.map((item) => String(item ?? "")) : [],
      }))
      .filter((row) => row.label);
    if (columns.length && rows.length) {
      return { columns, rows };
    }
  }
  return DEFAULT_SIZE_CHART;
}

function readCachedProduct(id) {
  if (!id) return null;
  try {
    const detailRaw = sessionStorage.getItem(DETAIL_CACHE_KEY);
    if (detailRaw) {
      const parsed = JSON.parse(detailRaw);
      const cached = parsed?.details?.[id];
      if (cached && Date.now() - (parsed.ts || 0) < CACHE_MS) {
        return cached;
      }
    }
    const listRaw = sessionStorage.getItem(LIST_CACHE_KEY);
    if (listRaw) {
      const parsed = JSON.parse(listRaw);
      if (Date.now() - (parsed.ts || 0) < CACHE_MS) {
        return (parsed.products || []).find((item) => item.id === id) || null;
      }
    }
  } catch {
    return null;
  }
  return null;
}

function writeCachedProduct(product) {
  if (!product?.id) return;
  try {
    const parsed = JSON.parse(sessionStorage.getItem(DETAIL_CACHE_KEY) || "{}");
    const details = parsed.details && typeof parsed.details === "object" ? parsed.details : {};
    details[product.id] = product;
    sessionStorage.setItem(
      DETAIL_CACHE_KEY,
      JSON.stringify({ ts: Date.now(), details }),
    );
  } catch {
    // Ignore quota / private mode.
  }
}

function prefetchImages(urls) {
  (urls || []).slice(0, 4).forEach((src) => {
    if (!src) return;
    const img = new Image();
    img.decoding = "async";
    img.src = src;
  });
}

function normalizeProduct(docSnap) {
  const data = docSnap.data() || {};
  const images = Array.isArray(data.images)
    ? data.images.filter(Boolean)
    : String(data.images || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
  const priceCurrent = toNumber(data.priceCurrent ?? data.price);
  const priceOriginal = toNumber(data.priceOriginal ?? data.offer, priceCurrent);
  const discount = calculateDiscount(priceCurrent, priceOriginal);
  const sizes = Array.isArray(data.sizes)
    ? data.sizes.map((item) => String(item).trim()).filter(Boolean)
    : String(data.sizes || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);

  return {
    id: docSnap.id,
    name: String(data.name || "Unnamed product"),
    priceCurrent,
    priceOriginal,
    badge: String(data.badge || "").trim() || (discount ? `${discount}% OFF` : "NEW"),
    images,
    sizes: sizes.length ? sizes : DEFAULT_SIZES,
    sizeChart: normalizeSizeChart(data.sizeChart),
    isPublished: data.isPublished !== false,
  };
}

function showToast(message) {
  if (!els.toast) return;
  els.toast.textContent = message;
  els.toast.classList.add("is-visible");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.classList.remove("is-visible");
  }, 3000);
}

function loadCart() {
  try {
    const saved = JSON.parse(
      localStorage.getItem(CART_KEY) || localStorage.getItem(LEGACY_CART_KEY) || "[]",
    );
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function getCartCount(cart) {
  return cart.reduce((sum, item) => sum + (item.quantity || 1), 0);
}

function updateCartBadge() {
  const count = getCartCount(loadCart());
  if (els.cartBadge) els.cartBadge.textContent = String(count);
  if (typeof window.updateHeaderCartBadge === "function") {
    window.updateHeaderCartBadge();
  }
}

function saveCart(cart) {
  const subtotal = cart.reduce((sum, item) => sum + (item.price || 0), 0);
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  localStorage.setItem("store_subtotal", String(subtotal));
  updateCartBadge();
}

function addToCart(name, price, qty, size) {
  const cart = loadCart();
  const safeQty = Math.max(1, parseInt(qty, 10) || 1);
  cart.push({
    name,
    price: price * safeQty,
    unitPrice: price,
    quantity: safeQty,
    size,
  });
  saveCart(cart);
  showToast("Added successfully");
}

function updateTotals() {
  const total = unitPrice * quantity;
  if (els.price) els.price.textContent = String(total);
  if (els.unit) els.unit.textContent = `Unit: BDT ${unitPrice}`;
  if (els.qtyValue) els.qtyValue.textContent = String(quantity);
}

function updateSlider() {
  if (!els.track || slidesCount === 0) return;
  const slides = els.track.querySelectorAll(".pd-slide");
  slides.forEach((slide, index) => {
    slide.classList.toggle("is-active", index === slideIndex);
  });
  els.track.style.transform = `translateX(-${slideIndex * 100}%)`;
  if (els.thumbs) {
    els.thumbs.querySelectorAll(".pd-thumb").forEach((thumb, index) => {
      thumb.classList.toggle("is-active", index === slideIndex);
    });
  }
}

function setSlide(index) {
  if (slidesCount === 0) return;
  slideIndex = (index + slidesCount) % slidesCount;
  updateSlider();
}

function buildGallery(images) {
  if (!els.track) return;
  els.track.innerHTML = "";
  if (els.thumbs) els.thumbs.innerHTML = "";

  const items = images.length ? images : ["photos/any.jpeg"];
  slidesCount = items.length;
  slideIndex = 0;

  items.forEach((src, index) => {
    const slide = document.createElement("div");
    slide.className = "pd-slide";
    const img = document.createElement("img");
    img.src = src;
    img.alt = `Product image ${index + 1}`;
    img.loading = index === 0 ? "eager" : "lazy";
    img.addEventListener("click", () => openLightbox(src));
    slide.appendChild(img);
    els.track.appendChild(slide);

    if (els.thumbs) {
      const thumb = document.createElement("button");
      thumb.type = "button";
      thumb.className = "pd-thumb";
      thumb.setAttribute("aria-label", `View image ${index + 1}`);
      const thumbImg = document.createElement("img");
      thumbImg.src = src;
      thumbImg.alt = `Thumbnail ${index + 1}`;
      thumb.appendChild(thumbImg);
      thumb.addEventListener("click", () => setSlide(index));
      els.thumbs.appendChild(thumb);
    }
  });

  updateSlider();
}

function renderSizeChart(chart) {
  if (!els.chartHead || !els.chartBody || !chart) return;
  const columns = chart.columns || [];
  els.chartHead.innerHTML = `<tr><th scope="col">Size</th>${columns
    .map((col) => `<th scope="col">${col}</th>`)
    .join("")}</tr>`;
  els.chartBody.innerHTML = (chart.rows || [])
    .map(
      (row) =>
        `<tr><th scope="row">${row.label}</th>${columns
          .map((_, index) => `<td>${row.values[index] || ""}</td>`)
          .join("")}</tr>`,
    )
    .join("");
}

function buildSizeOptions(sizes) {
  if (!els.sizeOptions) return;
  els.sizeOptions.innerHTML = "";
  (sizes || DEFAULT_SIZES).forEach((size) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pd-size-btn";
    btn.textContent = size;
    btn.dataset.size = size;
    btn.addEventListener("click", () => {
      selectedSize = size;
      els.sizeOptions.querySelectorAll(".pd-size-btn").forEach((el) => {
        el.classList.toggle("is-selected", el.dataset.size === size);
      });
      if (els.sizeHint) {
        els.sizeHint.textContent = "";
        els.sizeHint.hidden = true;
      }
    });
    els.sizeOptions.appendChild(btn);
  });
}

function requireSize() {
  if (selectedSize) return true;
  if (els.sizeHint) {
    els.sizeHint.textContent = "Please select a size";
    els.sizeHint.hidden = false;
  }
  showToast("Please select a size");
  return false;
}

function renderProduct(data) {
  product = data;
  unitPrice = data.priceCurrent;
  quantity = 1;
  selectedSize = "";

  document.title = `${data.name} | Day-1`;

  if (els.title) els.title.textContent = data.name;
  if (els.offer) {
    els.offer.textContent = data.priceOriginal;
    els.offer.style.display =
      data.priceOriginal > data.priceCurrent ? "inline-flex" : "none";
  }
  if (els.badge) els.badge.textContent = data.badge;

  buildGallery(data.images);
  buildSizeOptions(data.sizes);
  renderSizeChart(data.sizeChart);
  updateTotals();

  if (els.status) els.status.hidden = true;
  if (els.page) els.page.hidden = false;
}

function showError(message) {
  if (els.status) {
    els.status.textContent = message;
    els.status.hidden = false;
  }
  if (els.page) els.page.hidden = true;
}

async function loadProduct() {
  if (!productId) {
    showError("Product not found. Go back to shop and try again.");
    return;
  }

  const cached = readCachedProduct(productId);
  if (cached && cached.isPublished !== false) {
    renderProduct({
      ...cached,
      sizes: cached.sizes?.length ? cached.sizes : DEFAULT_SIZES,
      sizeChart: normalizeSizeChart(cached.sizeChart),
    });
    prefetchImages(cached.images);
  }

  try {
    const snap = await getDoc(doc(db, PRODUCTS_COLLECTION, productId));
    if (!snap.exists()) {
      if (!cached) showError("This product is no longer available.");
      return;
    }
    const data = normalizeProduct(snap);
    if (!data.isPublished) {
      if (!cached) showError("This product is no longer available.");
      return;
    }
    writeCachedProduct(data);
    renderProduct(data);
    prefetchImages(data.images);
  } catch (error) {
    console.error("Failed to load product", error);
    if (!cached) {
      showError("Could not load product. Please try again.");
    }
  }
}

function setupLightbox() {
  const lb = els.lightbox;
  const lbImg = lb ? lb.querySelector("img") : null;
  if (!lb || !lbImg) return;

  let lbScale = 1;
  let lbX = 0;
  let lbY = 0;
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let lastTouchDist = null;

  function applyTransform() {
    lbImg.style.transform = `translate(${lbX}px, ${lbY}px) scale(${lbScale})`;
  }

  window.openLightbox = function openLightbox(src) {
    lbImg.src = src;
    lbScale = 1;
    lbX = 0;
    lbY = 0;
    applyTransform();
    lb.classList.add("lb-open");
    document.body.style.overflow = "hidden";
  };

  function closeLightbox() {
    lb.classList.remove("lb-open");
    document.body.style.overflow = "";
  }

  if (els.zoomBtn) {
    els.zoomBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const active =
        els.track?.querySelector(".pd-slide.is-active img") ||
        els.track?.querySelector(".pd-slide img");
      if (active) window.openLightbox(active.src);
    });
  }

  lb.addEventListener("click", (e) => {
    if (e.target === lb) closeLightbox();
  });
  if (els.lbClose) els.lbClose.addEventListener("click", closeLightbox);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && lb.classList.contains("lb-open")) closeLightbox();
  });

  lb.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.12 : 0.12;
      lbScale = Math.min(Math.max(lbScale + delta, 0.5), 5);
      applyTransform();
    },
    { passive: false },
  );

  lbImg.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    dragging = true;
    startX = e.clientX - lbX;
    startY = e.clientY - lbY;
    lbImg.classList.add("lb-dragging");
    e.preventDefault();
  });
  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    lbX = e.clientX - startX;
    lbY = e.clientY - startY;
    applyTransform();
  });
  window.addEventListener("mouseup", () => {
    dragging = false;
    lbImg.classList.remove("lb-dragging");
  });

  lbImg.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches.length === 1) {
        startX = e.touches[0].clientX - lbX;
        startY = e.touches[0].clientY - lbY;
        lastTouchDist = null;
      } else if (e.touches.length === 2) {
        lastTouchDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY,
        );
      }
    },
    { passive: true },
  );
  lbImg.addEventListener(
    "touchmove",
    (e) => {
      e.preventDefault();
      if (e.touches.length === 1) {
        lbX = e.touches[0].clientX - startX;
        lbY = e.touches[0].clientY - startY;
        applyTransform();
      } else if (e.touches.length === 2) {
        const dist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY,
        );
        if (lastTouchDist) {
          lbScale = Math.min(Math.max(lbScale * (dist / lastTouchDist), 0.5), 5);
          applyTransform();
        }
        lastTouchDist = dist;
      }
    },
    { passive: false },
  );

  let lastTap = 0;
  lbImg.addEventListener("touchend", () => {
    const now = Date.now();
    if (now - lastTap < 300) {
      lbScale = 1;
      lbX = 0;
      lbY = 0;
      applyTransform();
    }
    lastTap = now;
  });
}

function openLightbox(src) {
  if (typeof window.openLightbox === "function") {
    window.openLightbox(src);
  }
}

function setupNav() {
  const hamburger = document.querySelector(".hamburger");
  const mobileMenu = document.getElementById("mobile-menu");
  if (!hamburger || !mobileMenu) return;

  hamburger.addEventListener("click", (e) => {
    e.stopPropagation();
    mobileMenu.classList.toggle("open");
    const icon = hamburger.querySelector("i");
    if (mobileMenu.classList.contains("open")) {
      icon.classList.replace("fa-bars", "fa-times");
    } else {
      icon.classList.replace("fa-times", "fa-bars");
    }
  });

  document.addEventListener("click", (e) => {
    if (!mobileMenu.contains(e.target) && !hamburger.contains(e.target)) {
      if (mobileMenu.classList.contains("open")) {
        mobileMenu.classList.remove("open");
        hamburger.querySelector("i").classList.replace("fa-times", "fa-bars");
      }
    }
  });
}

function bindActions() {
  if (els.qtyPlus) {
    els.qtyPlus.addEventListener("click", () => {
      quantity += 1;
      updateTotals();
    });
  }
  if (els.qtyMinus) {
    els.qtyMinus.addEventListener("click", () => {
      if (quantity > 1) {
        quantity -= 1;
        updateTotals();
      }
    });
  }
  if (els.prev) {
    els.prev.addEventListener("click", () => setSlide(slideIndex - 1));
  }
  if (els.next) {
    els.next.addEventListener("click", () => setSlide(slideIndex + 1));
  }
  if (els.addBtn) {
    els.addBtn.addEventListener("click", () => {
      if (!product || !requireSize()) return;
      addToCart(product.name.toLowerCase(), unitPrice, quantity, selectedSize);
    });
  }
  if (els.buyBtn) {
    els.buyBtn.addEventListener("click", () => {
      if (!product || !requireSize()) return;
      addToCart(product.name.toLowerCase(), unitPrice, quantity, selectedSize);
      window.location.href = "shop.html?checkout=true";
    });
  }
  if (els.cartButton) {
    els.cartButton.addEventListener("click", () => {
      if (typeof window.openGlobalCart === "function") {
        window.openGlobalCart();
      }
    });
  }

  let startX = 0;
  if (els.track) {
    els.track.addEventListener(
      "touchstart",
      (e) => {
        startX = e.touches[0].clientX;
      },
      { passive: true },
    );
    els.track.addEventListener(
      "touchend",
      (e) => {
        const delta = e.changedTouches[0].clientX - startX;
        if (Math.abs(delta) > 40) {
          setSlide(slideIndex + (delta < 0 ? 1 : -1));
        }
      },
      { passive: true },
    );
  }
}

setupLightbox();
setupNav();
bindActions();
updateCartBadge();
loadProduct();
