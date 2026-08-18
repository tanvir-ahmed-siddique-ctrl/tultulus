(function () {
  const CART_KEY = "store_cart";
  const LEGACY_KEY = "accolade_cart";
  const SUBTOTAL_KEY = "store_subtotal";

  function loadCart() {
    try {
      const raw = localStorage.getItem(CART_KEY) || localStorage.getItem(LEGACY_KEY) || "[]";
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function saveCart(cart) {
    const subtotal = cart.reduce((sum, item) => sum + (item.price || 0), 0);
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
    localStorage.setItem(SUBTOTAL_KEY, String(subtotal));
  }

  function cartCount(cart) {
    return (cart || loadCart()).reduce((sum, item) => sum + (item.quantity || 1), 0);
  }

  function updateBadge() {
    const count = String(cartCount());
    document.querySelectorAll("#cart-badge").forEach((badge) => {
      badge.textContent = count;
    });
  }

  function isShopPage() {
    return /shop\.html$/i.test(window.location.pathname);
  }

  function ensureCartModal() {
    if (document.getElementById("cart-modal") || document.getElementById("global-cart-modal")) {
      return document.getElementById("cart-modal") || document.getElementById("global-cart-modal");
    }

    if (!document.getElementById("global-cart-styles")) {
      const style = document.createElement("style");
      style.id = "global-cart-styles";
      style.textContent = `
        #global-cart-modal {
          position: fixed; inset: 0; z-index: 80;
          background: rgba(8, 8, 8, 0.62);
          display: flex; align-items: center; justify-content: center;
          padding: 24px;
        }
        #global-cart-modal[hidden] { display: none !important; }
        .global-cart-panel {
          width: min(460px, 92vw);
          max-height: 86vh;
          overflow: auto;
          background: rgba(18, 16, 14, 0.96);
          border: 1px solid rgba(255,255,255,0.2);
          border-radius: 24px;
          padding: 18px;
          color: #fff;
          display: grid;
          gap: 14px;
        }
        .global-cart-header {
          display: flex; align-items: center; justify-content: space-between; gap: 12px;
        }
        .global-cart-header strong {
          letter-spacing: 0.18em; text-transform: uppercase; font-size: 13px;
        }
        .global-cart-items { display: grid; gap: 10px; }
        .global-cart-item {
          display: flex; justify-content: space-between; gap: 12px; align-items: center;
          border: 1px solid rgba(255,255,255,0.16);
          border-radius: 14px; padding: 12px;
        }
        .global-cart-item button {
          border: 1px solid #c4342f; color: #c4342f; background: transparent;
          border-radius: 999px; padding: 6px 10px; font-size: 10px; letter-spacing: 0.12em;
          text-transform: uppercase; cursor: pointer;
        }
        .global-cart-empty, .global-cart-subtotal { font-size: 13px; }
        .global-cart-actions { display: grid; gap: 8px; }
        .global-cart-actions button, .global-cart-header button {
          min-height: 42px; border-radius: 999px; cursor: pointer; font-size: 11px;
          letter-spacing: 0.16em; text-transform: uppercase; font-weight: 700;
        }
        .global-cart-close, .global-cart-continue {
          background: transparent; color: #fff; border: 1px solid rgba(255,255,255,0.4);
          padding: 0 14px;
        }
        .global-cart-checkout {
          background: #faf7f2; color: #1f1f1f; border: none;
        }
      `;
      document.head.appendChild(style);
    }

    const modal = document.createElement("div");
    modal.id = "global-cart-modal";
    modal.hidden = true;
    modal.innerHTML = `
      <div class="global-cart-panel" role="dialog" aria-modal="true" aria-label="Your cart">
        <div class="global-cart-header">
          <strong>Your cart</strong>
          <button type="button" class="global-cart-close" data-cart-close>Close</button>
        </div>
        <div class="global-cart-items" id="global-cart-items"></div>
        <div class="global-cart-subtotal" id="global-cart-subtotal">Subtotal: 0 Tk</div>
        <div class="global-cart-actions">
          <button type="button" class="global-cart-continue" data-cart-close>Continue shopping</button>
          <button type="button" class="global-cart-checkout" id="global-cart-checkout">Proceed to checkout</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.addEventListener("click", (event) => {
      if (event.target === modal || event.target.closest("[data-cart-close]")) {
        closeGlobalCart();
      }
    });
    modal.querySelector("#global-cart-checkout").addEventListener("click", () => {
      window.location.href = "shop.html?checkout=true";
    });
    return modal;
  }

  function renderGlobalCart() {
    const itemsEl = document.getElementById("global-cart-items");
    const subtotalEl = document.getElementById("global-cart-subtotal");
    if (!itemsEl) return;
    const cart = loadCart();
    if (!cart.length) {
      itemsEl.innerHTML = '<p class="global-cart-empty">Your cart is empty.</p>';
      if (subtotalEl) subtotalEl.textContent = "Subtotal: 0 Tk";
      return;
    }
    itemsEl.innerHTML = cart
      .map((item, index) => {
        const qty = item.quantity > 1 ? ` x${item.quantity}` : "";
        const size = item.size && item.size !== "SELECT SIZE" ? ` · ${item.size}` : "";
        return `<div class="global-cart-item">
          <div>
            <div>${item.name}${qty}${size}</div>
            <div>${item.price} Tk</div>
          </div>
          <button type="button" data-remove="${index}">Remove</button>
        </div>`;
      })
      .join("");
    itemsEl.querySelectorAll("[data-remove]").forEach((button) => {
      button.addEventListener("click", () => {
        const cartItems = loadCart();
        cartItems.splice(Number(button.dataset.remove), 1);
        saveCart(cartItems);
        updateBadge();
        renderGlobalCart();
      });
    });
    const subtotal = cart.reduce((sum, item) => sum + (item.price || 0), 0);
    if (subtotalEl) subtotalEl.textContent = `Subtotal: ${subtotal} Tk`;
  }

  function openGlobalCart() {
    if (isShopPage() && typeof window.openCartModal === "function") {
      window.openCartModal();
      return;
    }
    ensureCartModal();
    renderGlobalCart();
    const modal = document.getElementById("global-cart-modal");
    if (modal) modal.hidden = false;
  }

  function closeGlobalCart() {
    const modal = document.getElementById("global-cart-modal");
    if (modal) modal.hidden = true;
  }

  document.addEventListener("DOMContentLoaded", () => {
    updateBadge();
    const button = document.getElementById("cart-button");
    if (button) {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        openGlobalCart();
      });
    }
  });

  window.updateHeaderCartBadge = updateBadge;
  window.openGlobalCart = openGlobalCart;
  window.closeGlobalCart = closeGlobalCart;
})();
