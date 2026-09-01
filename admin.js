import {
  addDoc,
  auth,
  collection,
  db,
  deleteDoc,
  doc,
  getDocs,
  onAuthStateChanged,
  serverTimestamp,
  signInWithEmailAndPassword,
  signOut,
  updateDoc,
} from "./firebase-config.js";

const PRODUCTS_COLLECTION = "products";
const state = {
  editingId: null,
  products: [],
};

const loginForm = document.getElementById("admin-login-form");
const loginError = document.getElementById("admin-login-error");
const loginCard = document.getElementById("admin-login-card");
const dashboardCard = document.getElementById("admin-dashboard");
const logoutButton = document.getElementById("admin-logout");
const userEmailLabel = document.getElementById("admin-user-email");
const productForm = document.getElementById("product-form");
const productStatus = document.getElementById("product-status");
const productList = document.getElementById("product-list");
const formTitle = document.getElementById("product-form-title");
const cancelEditButton = document.getElementById("cancel-edit");
const saveProductButton = document.getElementById("save-product");
const productCountLabel = document.getElementById("product-count");
const publishedCountLabel = document.getElementById("published-count");
const editorModeLabel = document.getElementById("editor-mode");
const previewImage = document.getElementById("preview-image");
const previewName = document.getElementById("preview-name");
const previewCurrent = document.getElementById("preview-current");
const previewOriginal = document.getElementById("preview-original");
const previewBadge = document.getElementById("preview-badge");
const previewChip = document.getElementById("preview-chip");
const productImagesInput = document.getElementById("product-images");
const imageFilesInput = document.getElementById("product-image-files");
const uploadProductImagesButton = document.getElementById("upload-product-images");
const uploadStatus = document.getElementById("upload-status");

const SIGNATURE_ENDPOINT = "/.netlify/functions/cloudinary-signature";
const MAX_UPLOAD_SIZE_MB = 8;
const PRODUCT_UPLOAD_FOLDER = "day1/products";

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseList(value, separatorRegex = /[\n,]+/) {
  return String(value || "")
    .split(separatorRegex)
    .map((item) => item.trim())
    .filter(Boolean);
}

const DEFAULT_CHART = {
  columns: ["Length", "Chest", "Sleeve"],
  rows: [
    { label: "S", values: ['68 cm (26.8")', '55 cm (21.7")', '26 cm (10.2")'] },
    { label: "M", values: ['70 cm (27.6")', '57 cm (22.4")', '27 cm (10.6")'] },
    { label: "L", values: ['72 cm (28.3")', '59 cm (23.2")', '28 cm (11.0")'] },
    { label: "XL", values: ['74 cm (29.1")', '61 cm (24.0")', '29 cm (11.4")'] },
  ],
};

let chartState = JSON.parse(JSON.stringify(DEFAULT_CHART));

function parseSizes(value) {
  return String(value || "")
    .split(/[,|\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseColors(value) {
  return String(value || "")
    .split(/[,|\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseRawTextToChart(rawText) {
  const lines = String(rawText || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^[|\s\-:]+$/.test(line));

  if (!lines.length) return null;

  const parsedLines = lines.map((line) => {
    let sep = "|";
    if (line.includes("\t")) {
      sep = "\t";
    } else if (!line.includes("|") && line.includes(",")) {
      sep = ",";
    }
    const cells = line.split(sep).map((c) => c.trim());
    if (cells.length > 1 && cells[0] === "") cells.shift();
    if (cells.length > 1 && cells[cells.length - 1] === "") cells.pop();
    return cells;
  }).filter((cells) => cells.length > 0);

  if (!parsedLines.length) return null;

  const headerCells = parsedLines[0];
  const columns = headerCells.slice(1).map((col) => col.trim()).filter(Boolean);

  const rows = [];
  for (let i = 1; i < parsedLines.length; i++) {
    const rowCells = parsedLines[i];
    const label = rowCells[0] ? rowCells[0].trim() : "";
    if (!label) continue;
    const values = [];
    const colCount = columns.length || 1;
    for (let c = 0; c < colCount; c++) {
      values.push(rowCells[c + 1] !== undefined ? rowCells[c + 1].trim() : "");
    }
    rows.push({ label, values });
  }

  if (!columns.length && !rows.length) return null;
  return {
    columns: columns.length ? columns : ["Measurement"],
    rows: rows.length ? rows : [{ label: "S", values: [""] }],
  };
}

function chartToRawText(chart) {
  if (!chart || !Array.isArray(chart.columns) || !Array.isArray(chart.rows)) return "";
  const header = ["Size", ...chart.columns].join(" | ");
  const rowLines = chart.rows.map((row) =>
    [row.label || "", ...(row.values || []).map((v) => v || "")].join(" | ")
  );
  return [header, ...rowLines].join("\n");
}

function readChartFromDom() {
  const checkbox = document.getElementById("enable-size-chart");
  if (checkbox && !checkbox.checked) {
    return DEFAULT_CHART;
  }
  const rawText = document.getElementById("size-chart-raw-text")?.value;
  const parsedFromText = parseRawTextToChart(rawText);
  if (parsedFromText && parsedFromText.columns.length && parsedFromText.rows.length) {
    return parsedFromText;
  }
  const table = document.getElementById("size-chart-table");
  if (!table) return DEFAULT_CHART;
  const headerInputs = table.querySelectorAll("thead input[data-col]");
  const columns = Array.from(headerInputs).map((input) => input.value.trim()).filter(Boolean);
  const rows = Array.from(table.querySelectorAll("tbody tr")).map((tr) => {
    const label = tr.querySelector("input[data-row-label]")?.value.trim() || "";
    const values = Array.from(tr.querySelectorAll("input[data-row-cell]")).map((input) => input.value);
    return { label, values };
  }).filter((row) => row.label);
  if (!columns.length || !rows.length) {
    return DEFAULT_CHART;
  }
  return { columns, rows };
}

function renderSizeChartEditor(options = {}) {
  const table = document.getElementById("size-chart-table");
  const rawTextArea = document.getElementById("size-chart-raw-text");

  if (rawTextArea && !options.skipRawTextSync) {
    rawTextArea.value = chartToRawText(chartState);
  }

  if (!table) return;
  const columns = chartState.columns.length ? chartState.columns : ["Measurement"];
  table.innerHTML = `
    <thead>
      <tr>
        <th>Size</th>
        ${columns
          .map(
            (col, index) => `
          <th>
            <input data-col="${index}" value="${escapeHtml(col)}" />
            <button type="button" class="secondary" data-remove-col="${index}">Remove</button>
          </th>`,
          )
          .join("")}
      </tr>
    </thead>
    <tbody>
      ${chartState.rows
        .map(
          (row, rowIndex) => `
        <tr>
          <td>
            <input data-row-label="${rowIndex}" value="${escapeHtml(row.label)}" placeholder="S / 28" />
            <button type="button" class="danger" data-remove-row="${rowIndex}">Remove</button>
          </td>
          ${columns
            .map(
              (_, colIndex) => `
            <td><input data-row-cell="${rowIndex}-${colIndex}" value="${escapeHtml(row.values[colIndex] || "")}" placeholder="—" /></td>`,
            )
            .join("")}
        </tr>`,
        )
        .join("")}
    </tbody>
  `;

  table.querySelectorAll("input").forEach((input) => {
    input.addEventListener("input", () => {
      chartState = readChartFromDom();
      if (rawTextArea) {
        rawTextArea.value = chartToRawText(chartState);
      }
    });
  });
  table.querySelectorAll("[data-remove-col]").forEach((button) => {
    button.addEventListener("click", () => {
      chartState = readChartFromDom();
      const index = Number(button.dataset.removeCol);
      if (chartState.columns.length <= 1) return;
      chartState.columns.splice(index, 1);
      chartState.rows.forEach((row) => row.values.splice(index, 1));
      renderSizeChartEditor();
    });
  });
  table.querySelectorAll("[data-remove-row]").forEach((button) => {
    button.addEventListener("click", () => {
      chartState = readChartFromDom();
      const index = Number(button.dataset.removeRow);
      chartState.rows.splice(index, 1);
      renderSizeChartEditor();
    });
  });
}

function setChartState(nextChart) {
  if (nextChart && Array.isArray(nextChart.columns) && Array.isArray(nextChart.rows) && nextChart.columns.length && nextChart.rows.length) {
    chartState = {
      columns: nextChart.columns.map((item) => String(item || "").trim()).filter(Boolean),
      rows: nextChart.rows.map((row) => ({
        label: String(row.label || row.size || "").trim(),
        values: Array.isArray(row.values) ? row.values.map((item) => String(item ?? "")) : [],
      })).filter((row) => row.label),
    };
  } else {
    chartState = JSON.parse(JSON.stringify(DEFAULT_CHART));
  }
  if (!chartState.columns.length) chartState.columns = ["Measurement"];
  if (!chartState.rows.length) chartState.rows = [{ label: "S", values: [""] }];
  renderSizeChartEditor();
}

function toNumber(value) {
  const parsed = Number.parseInt(String(value || "").replace(/[^\d]/g, ""), 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function getTimestamp(value) {
  if (!value) {
    return 0;
  }
  if (typeof value.toMillis === "function") {
    return value.toMillis();
  }
  if (typeof value.seconds === "number") {
    return value.seconds * 1000;
  }
  return 0;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function setText(element, value) {
  if (element) {
    element.textContent = value;
  }
}

function setStatus(message, type = "normal") {
  if (!productStatus) {
    return;
  }
  productStatus.textContent = message;
  productStatus.classList.remove("is-error", "is-success");
  if (type === "error") {
    productStatus.classList.add("is-error");
  }
  if (type === "success") {
    productStatus.classList.add("is-success");
  }
}

function setUploadStatus(message, type = "normal") {
  if (!uploadStatus) {
    return;
  }
  uploadStatus.textContent = message;
  uploadStatus.classList.remove("is-error", "is-success");
  if (type === "error") {
    uploadStatus.classList.add("is-error");
  }
  if (type === "success") {
    uploadStatus.classList.add("is-success");
  }
}

function updateDashboardStats() {
  setText(productCountLabel, state.products.length);
  setText(
    publishedCountLabel,
    state.products.filter((product) => product.isPublished !== false).length,
  );
  setText(editorModeLabel, state.editingId ? "Edit" : "Add");
}

function getPreviewFields() {
  const name = document.getElementById("product-name")?.value.trim();
  const priceCurrent = toNumber(document.getElementById("price-current")?.value);
  const rawOriginal = document.getElementById("price-original")?.value;
  const priceOriginal = rawOriginal ? toNumber(rawOriginal) : priceCurrent;
  const discount =
    priceCurrent && priceOriginal && priceOriginal > priceCurrent
      ? Math.round(((priceOriginal - priceCurrent) / priceOriginal) * 100)
      : null;
  const badgeInput = document.getElementById("product-badge")?.value.trim();
  const badge = badgeInput || (discount ? `${discount}% OFF` : "NEW");
  const images = parseList(document.getElementById("product-images")?.value);
  const isFeatured = document.getElementById("category-featured")?.checked;
  const isHot = document.getElementById("category-hot")?.checked;

  const discountHintEl = document.getElementById("discount-calc-hint");
  if (discountHintEl) {
    discountHintEl.textContent = discount ? `(Auto discount: ${discount}% OFF)` : "";
  }

  return {
    name: name || "Product name",
    priceCurrent,
    priceOriginal: priceOriginal || priceCurrent,
    hasDiscount: !!discount,
    badge,
    primaryImage: images[0] || "photos/any.jpeg",
    chip: isFeatured ? "Featured" : isHot ? "Hot Selling" : "Product",
  };
}

function updatePreview() {
  if (!productForm) {
    return;
  }

  const preview = getPreviewFields();
  if (previewImage) {
    previewImage.src = preview.primaryImage;
    previewImage.alt = `${preview.name} preview`;
  }
  setText(previewName, preview.name);
  setText(previewCurrent, preview.priceCurrent || 0);
  if (previewOriginal) {
    previewOriginal.textContent = preview.priceOriginal || 0;
    previewOriginal.style.display = preview.hasDiscount ? "inline" : "none";
  }
  setText(previewBadge, preview.badge);
  setText(previewChip, preview.chip);
}

function resetForm(statusMessage = "Ready", statusType = "normal") {
  if (!productForm) {
    return;
  }
  productForm.reset();
  state.editingId = null;
  const enableChart = document.getElementById("enable-size-chart");
  const chartSection = document.getElementById("size-chart-editor-section");
  if (enableChart) enableChart.checked = false;
  if (chartSection) chartSection.classList.add("hidden-section");
  chartState = JSON.parse(JSON.stringify(DEFAULT_CHART));
  renderSizeChartEditor();
  const sizesInput = document.getElementById("product-sizes");
  if (sizesInput) sizesInput.value = "S, M, L, XL";
  const colorsInput = document.getElementById("product-colors");
  if (colorsInput) colorsInput.value = "";
  const descInput = document.getElementById("product-description");
  if (descInput) descInput.value = "";
  formTitle.textContent = "Add new product";
  cancelEditButton.classList.add("hidden-section");
  if (saveProductButton) {
    saveProductButton.textContent = "Save product";
  }
  updateDashboardStats();
  updatePreview();
  setStatus(statusMessage, statusType);
  setUploadStatus("No upload started");
}

function setUploadButtonsDisabled(isDisabled) {
  if (uploadProductImagesButton) {
    uploadProductImagesButton.disabled = isDisabled;
  }
}

function validateFiles(files) {
  if (!files.length) {
    throw new Error("Please select at least one image file.");
  }

  files.forEach((file) => {
    if (!file.type.startsWith("image/")) {
      throw new Error(`"${file.name}" is not a valid image file.`);
    }
    if (file.size > MAX_UPLOAD_SIZE_MB * 1024 * 1024) {
      throw new Error(
        `"${file.name}" is larger than ${MAX_UPLOAD_SIZE_MB}MB. Please compress it first.`,
      );
    }
  });
}

async function requestUploadSignature(folder) {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error("Please sign in first.");
  }

  const idToken = await currentUser.getIdToken();
  const response = await fetch(SIGNATURE_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ idToken, folder }),
  });

  let payload = {};
  try {
    payload = await response.json();
  } catch (error) {
    payload = {};
  }

  if (!response.ok) {
    throw new Error(payload.error || "Could not get upload signature.");
  }
  return payload;
}

async function uploadSingleFile(file, signatureData) {
  const uploadForm = new FormData();
  uploadForm.append("file", file);
  uploadForm.append("api_key", signatureData.apiKey);
  uploadForm.append("timestamp", String(signatureData.timestamp));
  uploadForm.append("signature", signatureData.signature);
  uploadForm.append("folder", signatureData.folder);

  const response = await fetch(signatureData.uploadUrl, {
    method: "POST",
    body: uploadForm,
  });
  const payload = await response.json();

  if (!response.ok || !payload.secure_url) {
    throw new Error(payload.error?.message || `Upload failed for "${file.name}".`);
  }

  return payload.secure_url;
}

function appendUrlsToProductImages(urls) {
  if (!productImagesInput || !urls.length) {
    return;
  }
  const existing = parseList(productImagesInput.value);
  const merged = [...existing, ...urls];
  productImagesInput.value = merged.join("\n");
  updatePreview();
}

async function handleUpload() {
  if (!imageFilesInput) {
    return;
  }

  try {
    const files = Array.from(imageFilesInput.files || []);
    validateFiles(files);
    setUploadButtonsDisabled(true);

    setUploadStatus("Getting secure upload token...");
    const signatureData = await requestUploadSignature(PRODUCT_UPLOAD_FOLDER);

    const uploadedUrls = [];
    for (let index = 0; index < files.length; index += 1) {
      setUploadStatus(`Uploading ${index + 1}/${files.length}: ${files[index].name}`);
      const url = await uploadSingleFile(files[index], signatureData);
      uploadedUrls.push(url);
    }

    appendUrlsToProductImages(uploadedUrls);
    setUploadStatus(
      `${uploadedUrls.length} image URL${
        uploadedUrls.length > 1 ? "s" : ""
      } added to product images.`,
      "success",
    );

    imageFilesInput.value = "";
  } catch (error) {
    console.error("Upload failed", error);
    setUploadStatus(error.message || "Upload failed.", "error");
  } finally {
    setUploadButtonsDisabled(false);
  }
}

function getCategoriesFromForm() {
  const categories = new Set(["all"]);
  const featured = document.getElementById("category-featured").checked;
  const hotSelling = document.getElementById("category-hot").checked;
  if (featured) {
    categories.add("featured");
  }
  if (hotSelling) {
    categories.add("hot-selling");
  }
  return {
    categories: Array.from(categories),
    featured,
    hotSelling,
  };
}

function getFormData() {
  const name = document.getElementById("product-name").value.trim();
  const priceCurrent = toNumber(document.getElementById("price-current").value);
  const priceOriginal = toNumber(
    document.getElementById("price-original").value || `${priceCurrent}`,
  );
  const badge = document.getElementById("product-badge").value.trim();
  const imageUrls = parseList(document.getElementById("product-images").value);
  const sizes = parseSizes(document.getElementById("product-sizes")?.value);
  const colors = parseColors(document.getElementById("product-colors")?.value);
  const sizeChart = readChartFromDom() || DEFAULT_CHART;
  const description = document.getElementById("product-description")?.value.trim() || "";
  const sortOrder = Number.parseInt(
    document.getElementById("product-sort-order").value,
    10,
  );
  const isPublished = document.getElementById("product-published").checked;
  const { categories, featured, hotSelling } = getCategoriesFromForm();

  if (!name) {
    throw new Error("Product name is required.");
  }
  if (!imageUrls.length) {
    throw new Error("At least one image URL is required.");
  }
  if (!priceCurrent) {
    throw new Error("Current price is required.");
  }

  return {
    name,
    priceCurrent,
    priceOriginal: priceOriginal || priceCurrent,
    badge: badge || "NEW",
    images: imageUrls,
    sizes: sizes.length ? sizes : ["S", "M", "L", "XL"],
    colors: colors.length ? colors : [],
    description,
    sizeChart,
    categories,
    featured,
    hotSelling,
    isPublished,
    sortOrder: Number.isNaN(sortOrder) ? 9999 : sortOrder,
  };
}

function renderProductList() {
  if (!productList) {
    return;
  }
  updateDashboardStats();
  if (!state.products.length) {
    productList.innerHTML = `
      <p class="empty-note">No products found yet. Add the first product using the form.</p>
    `;
    return;
  }

  productList.innerHTML = state.products
    .map((product) => {
      const categories = product.categories?.join(", ") || "all";
      const visibility = product.isPublished === false ? "Draft" : "Published";
      return `
        <article class="product-row">
          <img src="${escapeHtml(product.images?.[0] || "photos/any.jpeg")}" alt="${escapeHtml(product.name)}" />
          <div class="product-row-info">
            <h3>${escapeHtml(product.name)}</h3>
            <p class="meta">USD ${escapeHtml(product.priceCurrent)} | ${escapeHtml(categories)} | ${visibility}</p>
            <div class="product-row-actions">
              <button type="button" data-edit-id="${escapeHtml(product.id)}">Edit</button>
              <button type="button" data-delete-id="${escapeHtml(product.id)}" class="danger">Delete</button>
            </div>
          </div>
        </article>
      `;
    })
    .join("");

  productList.querySelectorAll("[data-edit-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const selected = state.products.find(
        (product) => product.id === button.dataset.editId,
      );
      if (!selected) {
        return;
      }
      state.editingId = selected.id;
      formTitle.textContent = `Edit product: ${selected.name}`;
      cancelEditButton.classList.remove("hidden-section");
      if (saveProductButton) {
        saveProductButton.textContent = "Update product";
      }

      document.getElementById("product-name").value = selected.name || "";
      document.getElementById("price-current").value = selected.priceCurrent || "";
      document.getElementById("price-original").value = selected.priceOriginal || "";
      document.getElementById("product-badge").value = selected.badge || "";
      document.getElementById("product-images").value = (
        selected.images || []
      ).join("\n");
      document.getElementById("product-sizes").value = (selected.sizes || []).join(", ");
      document.getElementById("product-colors").value = (selected.colors || []).join(", ");
      const descField = document.getElementById("product-description");
      if (descField) descField.value = selected.description || "";
      const enableChart = document.getElementById("enable-size-chart");
      const chartSection = document.getElementById("size-chart-editor-section");
      if (selected.sizeChart && Array.isArray(selected.sizeChart.columns) && selected.sizeChart.columns.length && Array.isArray(selected.sizeChart.rows) && selected.sizeChart.rows.length) {
        if (enableChart) enableChart.checked = true;
        if (chartSection) chartSection.classList.remove("hidden-section");
        setChartState(selected.sizeChart);
      } else {
        if (enableChart) enableChart.checked = false;
        if (chartSection) chartSection.classList.add("hidden-section");
        setChartState(null);
      }
      document.getElementById("product-sort-order").value = selected.sortOrder ?? "";
      document.getElementById("product-published").checked =
        selected.isPublished !== false;
      document.getElementById("category-featured").checked =
        selected.featured === true || selected.categories?.includes("featured");
      document.getElementById("category-hot").checked =
        selected.hotSelling === true ||
        selected.categories?.includes("hot-selling");

      updateDashboardStats();
      updatePreview();
      window.scrollTo({ top: 0, behavior: "smooth" });
      setStatus("Editing existing product");
    });
  });

  productList.querySelectorAll("[data-delete-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      const product = state.products.find(
        (item) => item.id === button.dataset.deleteId,
      );
      if (!product) {
        return;
      }
      const isConfirmed = window.confirm(
        `Delete "${product.name}"? This cannot be undone.`,
      );
      if (!isConfirmed) {
        return;
      }
      try {
        await deleteDoc(doc(db, PRODUCTS_COLLECTION, product.id));
        setStatus("Product deleted", "success");
        await loadProducts();
      } catch (error) {
        console.error("Delete failed", error);
        setStatus("Delete failed. Check Firestore permissions.", "error");
      }
    });
  });
}

async function loadProducts() {
  const snapshot = await getDocs(collection(db, PRODUCTS_COLLECTION));
  state.products = snapshot.docs
    .map((docSnap) => {
      const data = docSnap.data() || {};
      const hasChart = data.sizeChart && Array.isArray(data.sizeChart.columns) && data.sizeChart.columns.length && Array.isArray(data.sizeChart.rows) && data.sizeChart.rows.length;
      return {
        id: docSnap.id,
        ...data,
        sizeChart: hasChart ? data.sizeChart : DEFAULT_CHART,
        createdAtMs: getTimestamp(data.createdAt),
      };
    })
    .sort((left, right) => {
      const leftSort = Number.isFinite(Number(left.sortOrder))
        ? Number(left.sortOrder)
        : 9999;
      const rightSort = Number.isFinite(Number(right.sortOrder))
        ? Number(right.sortOrder)
        : 9999;
      if (leftSort !== rightSort) {
        return leftSort - rightSort;
      }
      return right.createdAtMs - left.createdAtMs;
    });
  renderProductList();
}

async function syncMissingSizeCharts() {
  const btn = document.getElementById("admin-sync-size-charts");
  if (btn) btn.disabled = true;
  setStatus("Syncing missing size charts...");
  try {
    const snapshot = await getDocs(collection(db, PRODUCTS_COLLECTION));
    let updatedCount = 0;
    for (const docSnap of snapshot.docs) {
      const data = docSnap.data() || {};
      const hasChart = data.sizeChart && Array.isArray(data.sizeChart.columns) && data.sizeChart.columns.length && Array.isArray(data.sizeChart.rows) && data.sizeChart.rows.length;
      if (!hasChart) {
        await updateDoc(doc(db, PRODUCTS_COLLECTION, docSnap.id), {
          sizeChart: DEFAULT_CHART,
          updatedAt: serverTimestamp(),
        });
        updatedCount++;
      }
    }
    await loadProducts();
    setStatus(updatedCount > 0 ? `Successfully updated ${updatedCount} product(s) with default size chart.` : "All products already have a size chart.", "success");
  } catch (error) {
    console.error("Sync failed", error);
    setStatus("Sync failed: " + error.message, "error");
  } finally {
    if (btn) btn.disabled = false;
  }
}

if (loginForm) {
  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = document.getElementById("admin-email").value.trim();
    const password = document.getElementById("admin-password").value;
    loginError.textContent = "";

    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
      console.error("Login failed", error);
      loginError.textContent =
        "Sign in failed. Check email/password and authorized domain.";
    }
  });
}

if (logoutButton) {
  logoutButton.addEventListener("click", async () => {
    await signOut(auth);
  });
}

if (cancelEditButton) {
  cancelEditButton.addEventListener("click", resetForm);
}

if (uploadProductImagesButton) {
  uploadProductImagesButton.addEventListener("click", () => {
    handleUpload();
  });
}

const enableSizeChartCheckbox = document.getElementById("enable-size-chart");
const sizeChartEditorSection = document.getElementById("size-chart-editor-section");
const loadTemplateBtn = document.getElementById("chart-load-template");
const clearChartBtn = document.getElementById("chart-clear");
const syncSizeChartsBtn = document.getElementById("admin-sync-size-charts");

if (syncSizeChartsBtn) {
  syncSizeChartsBtn.addEventListener("click", () => {
    syncMissingSizeCharts();
  });
}

if (enableSizeChartCheckbox) {
  enableSizeChartCheckbox.addEventListener("change", () => {
    if (enableSizeChartCheckbox.checked) {
      if (sizeChartEditorSection) sizeChartEditorSection.classList.remove("hidden-section");
      if (!chartState.rows || chartState.rows.length === 0 || !chartState.columns || chartState.columns.length === 0) {
        setChartState(DEFAULT_CHART);
      } else {
        renderSizeChartEditor();
      }
    } else {
      if (sizeChartEditorSection) sizeChartEditorSection.classList.add("hidden-section");
    }
  });
}

const sizeChartRawTextArea = document.getElementById("size-chart-raw-text");
if (sizeChartRawTextArea) {
  sizeChartRawTextArea.addEventListener("input", () => {
    const parsed = parseRawTextToChart(sizeChartRawTextArea.value);
    if (parsed) {
      chartState = parsed;
      renderSizeChartEditor({ skipRawTextSync: true });
    }
  });
}

if (loadTemplateBtn) {
  loadTemplateBtn.addEventListener("click", () => {
    setChartState(DEFAULT_CHART);
  });
}

if (clearChartBtn) {
  clearChartBtn.addEventListener("click", () => {
    setChartState({ columns: ["Measurement"], rows: [{ label: "S", values: [""] }] });
  });
}

const addColButton = document.getElementById("chart-add-col");
const addRowButton = document.getElementById("chart-add-row");
if (addColButton) {
  addColButton.addEventListener("click", () => {
    chartState = readChartFromDom() || { columns: ["Measurement"], rows: [{ label: "S", values: [""] }] };
    const name = window.prompt("Column name", "Measurement");
    if (!name || !name.trim()) return;
    chartState.columns.push(name.trim());
    chartState.rows.forEach((row) => row.values.push(""));
    renderSizeChartEditor();
  });
}
if (addRowButton) {
  addRowButton.addEventListener("click", () => {
    chartState = readChartFromDom() || { columns: ["Measurement"], rows: [{ label: "S", values: [""] }] };
    const label = window.prompt("Size label", "XL");
    if (!label || !label.trim()) return;
    chartState.rows.push({
      label: label.trim(),
      values: chartState.columns.map(() => ""),
    });
    renderSizeChartEditor();
  });
}

if (productForm) {
  productForm.addEventListener("input", updatePreview);
  productForm.addEventListener("change", updatePreview);
  productForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (saveProductButton) {
      saveProductButton.disabled = true;
      saveProductButton.textContent = state.editingId ? "Updating..." : "Saving...";
    }
    setStatus(state.editingId ? "Updating product..." : "Saving product...");
    try {
      const payload = getFormData();
      if (state.editingId) {
        await updateDoc(doc(db, PRODUCTS_COLLECTION, state.editingId), {
          ...payload,
          updatedAt: serverTimestamp(),
        });
        await loadProducts();
        resetForm("Product updated successfully", "success");
      } else {
        await addDoc(collection(db, PRODUCTS_COLLECTION), {
          ...payload,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        await loadProducts();
        resetForm("Product added successfully", "success");
      }
    } catch (error) {
      console.error("Save failed", error);
      setStatus(error.message || "Save failed", "error");
    } finally {
      if (saveProductButton) {
        saveProductButton.disabled = false;
        saveProductButton.textContent = state.editingId
          ? "Update product"
          : "Save product";
      }
    }
  });
  updatePreview();
}

onAuthStateChanged(auth, async (user) => {
  const isLoggedIn = Boolean(user);
  loginCard.classList.toggle("hidden-section", isLoggedIn);
  dashboardCard.classList.toggle("hidden-section", !isLoggedIn);

  if (isLoggedIn) {
    userEmailLabel.textContent = user.email || "Admin";
    setStatus("Ready");
    await loadProducts();
  } else {
    userEmailLabel.textContent = "";
    state.products = [];
    renderProductList();
    resetForm();
  }
});
