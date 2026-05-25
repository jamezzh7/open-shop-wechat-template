const shopConfig = require('../../config/shop');
const { enableShareMenu, getShareAppMessage, getShareTimeline } = require('../../utils/share');

function formatPrice(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return '0';
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
}

function sortSkusByPrice(skus) {
  return (skus || []).slice().sort((a, b) => {
    const priceDelta = Number(a.price || 0) - Number(b.price || 0);
    if (priceDelta !== 0) return priceDelta;
    return Number(a.sort || 0) - Number(b.sort || 0);
  });
}

function decorateProduct(product, skus) {
  const productSkus = sortSkusByPrice(skus);
  const minPrice = productSkus.length ? Number(productSkus[0].price || 0) : 0;
  const cartQty = Number(product.cartQty || 0);

  return {
    ...product,
    skus: productSkus,
    price: minPrice,
    priceText: formatPrice(minPrice),
    priceSuffix: productSkus.length > 1 ? '起' : '',
    cartQty,
    specButtonText: cartQty > 0 ? `已选 ${cartQty}` : '选规格',
  };
}

function sortProductsBySort(products) {
  return (products || []).slice().sort((a, b) => {
    const sortDelta = Number(a.sort || 0) - Number(b.sort || 0);
    if (sortDelta !== 0) return sortDelta;
    return String(a.title || '').localeCompare(String(b.title || ''), 'zh-Hans-CN');
  });
}

Page({
  data: {
    categories: [],
    productSections: [],
    activeCategory: '',
    scrollToSection: '',
    loading: true,
    cart: [],
    cartTotalQty: 0,
    cartTotalPriceFormatted: '0.00',
    showModal: false,
    activeProduct: {},
    selectedSkuId: 0,
    selectedSkuPrice: '0.00',
    modalQty: 1,
    showCartDetail: false,
    customerServiceSession: shopConfig.customerServiceSession,
    customerServiceTitle: shopConfig.customerServiceTitle,
  },

  onLoad() {
    enableShareMenu();
    this._productsMap = {};
    this._loadCatalog();
    this._syncCartFromGlobal();
  },

  onShow() {
    this._syncCartFromGlobal();
  },

  async _loadCatalog() {
    try {
      const { result } = await wx.cloud.callFunction({ name: 'vibe_catalog' });
      if (!result.success) throw new Error('catalog load failed');

      const { categories, products, skus, recommendations = [] } = result;

      const skusByProduct = {};
      for (const sku of skus) {
        if (!skusByProduct[sku.productId]) skusByProduct[sku.productId] = [];
        skusByProduct[sku.productId].push(sku);
      }

      const productsById = {};
      for (const p of products) {
        productsById[p.id] = p;
      }

      this._productsMap = {};
      for (const p of products) {
        this._productsMap[p.id] = decorateProduct(p, skusByProduct[p.id] || []);
      }

      const productSections = categories.map(cat => ({
        ...cat,
        products: sortProductsBySort(
          cat.id === 1
            ? recommendations
              .filter(r => r.categoryId === cat.id)
              .map(r => {
                const product = productsById[r.productId];
                return product ? { ...product, sort: r.sort } : null;
              })
              .filter(Boolean)
            : products.filter(p => p.categoryId === cat.id),
        ).map(p => decorateProduct(p, skusByProduct[p.id] || [])),
      }));
      const cart = getApp().globalData.cart || [];

      this.setData({
        categories,
        productSections: this._decorateSectionsWithCart(productSections, cart),
        activeCategory: categories[0]?._id || '',
        loading: false,
      });

      setTimeout(() => this._measureSections(), 150);
    } catch (err) {
      console.error('[vibe] catalog load failed', err);
      wx.showToast({ title: '菜单加载失败', icon: 'none' });
      this.setData({ loading: false });
    }
  },

  _syncCartFromGlobal() {
    const globalCart = getApp().globalData.cart || [];
    this._setCartState(globalCart);
  },

  _decorateSectionsWithCart(productSections, cart) {
    const qtyByProduct = {};
    for (const item of cart || []) {
      const productId = item.productId;
      qtyByProduct[productId] = (qtyByProduct[productId] || 0) + Number(item.quantity || 0);
    }

    return (productSections || []).map(section => ({
      ...section,
      products: (section.products || []).map(product => {
        const cartQty = qtyByProduct[product.id] || 0;
        return {
          ...product,
          cartQty,
          specButtonText: cartQty > 0 ? `已选 ${cartQty}` : '选规格',
        };
      }),
    }));
  },

  _setCartState(cart) {
    const newCart = cart || [];
    const cartTotalQty = newCart.reduce((s, i) => s + i.quantity, 0);
    const cartTotalPrice = newCart.reduce((s, i) => s + i.price * i.quantity, 0);
    const updates = {
      cart: newCart,
      cartTotalQty,
      cartTotalPriceFormatted: cartTotalPrice.toFixed(2),
    };

    if (cartTotalQty === 0 && this.data.showCartDetail) {
      updates.showCartDetail = false;
    }

    if (this.data.productSections.length) {
      updates.productSections = this._decorateSectionsWithCart(this.data.productSections, newCart);
    }

    this.setData(updates);
  },

  _measureSections() {
    const { categories } = this.data;
    if (!categories.length) return;
    const query = wx.createSelectorQuery().in(this);
    query.select('.product-panel').boundingClientRect();
    query.selectAll('.product-section').boundingClientRect();
    query.exec(([panelRect, sectionRects]) => {
      if (!panelRect || !sectionRects || !sectionRects.length) return;
      this._sectionTops = sectionRects.map((r, i) => ({
        categoryId: categories[i]._id,
        top: r.top - panelRect.top,
      }));
    });
  },

  _updateGlobalCart(newCart) {
    getApp().globalData.cart = newCart;
    this._setCartState(newCart);
  },

  onCategoryTap(e) {
    const { id } = e.currentTarget.dataset;
    this._scrollingToSection = true;
    this.setData({ activeCategory: id, scrollToSection: 'section-' + id });
    setTimeout(() => { this._scrollingToSection = false; }, 400);
  },

  onProductScroll(e) {
    if (this._scrollingToSection) return;
    if (!this._sectionTops || !this._sectionTops.length) return;
    const scrollTop = e.detail.scrollTop;
    let activeId = this._sectionTops[0].categoryId;
    for (const s of this._sectionTops) {
      if (scrollTop + 1 >= s.top) activeId = s.categoryId;
    }
    if (activeId !== this.data.activeCategory) this.setData({ activeCategory: activeId });
  },

  onAddProduct(e) {
    const product = this._productsMap[e.currentTarget.dataset.id];
    if (!product) return;
    const skus = product.skus || [];
    if (!skus.length) return;
    this.setData({
      showModal: true,
      showCartDetail: false,
      activeProduct: product,
      selectedSkuId: skus[0].id,
      selectedSkuPrice: skus[0].price.toFixed(2),
      modalQty: 1,
    });
  },

  onQuickAddProduct(e) {
    const product = this._productsMap[e.currentTarget.dataset.id];
    if (!product) return;
    const skus = product.skus || [];
    if (skus.length === 1) {
      this._directAdd(product, skus[0]);
      return;
    }
    this.onAddProduct(e);
  },

  onListProductDecrease(e) {
    const product = this._productsMap[e.currentTarget.dataset.id];
    if (!product) return;
    const sku = (product.skus || [])[0];
    if (!sku) return;
    this._decreaseCartByKey(`${product.id}::${sku.id}`);
  },

  _directAdd(product, sku) {
    if (!sku) return;
    const { cart } = this.data;
    const key = `${product.id}::${sku.id}`;
    const existingIdx = cart.findIndex(item => item.key === key);
    const isFirstItem = cart.length === 0;
    const newCart = existingIdx >= 0
      ? cart.map((item, i) => i === existingIdx ? { ...item, quantity: item.quantity + 1 } : item)
      : [...cart, {
          key, productId: product.id, skuId: sku.id, skuName: sku.name,
          title: product.title, price: sku.price, image: product.image, quantity: 1,
        }];
    this._updateGlobalCart(newCart);
    if (isFirstItem) setTimeout(() => this._measureSections(), 350);
    wx.showToast({ title: '已加入购物车', icon: 'none', duration: 800 });
  },

  onCloseModal() { this.setData({ showModal: false }); },

  onSelectSku(e) {
    const skuid = e.currentTarget.dataset.skuid;
    const sku = (this.data.activeProduct.skus || []).find(s => s.id === skuid);
    if (!sku) return;
    this.setData({ selectedSkuId: skuid, selectedSkuPrice: sku.price.toFixed(2) });
  },

  onDecreaseQty() {
    if (this.data.modalQty <= 1) return;
    this.setData({ modalQty: this.data.modalQty - 1 });
  },

  onIncreaseQty() { this.setData({ modalQty: this.data.modalQty + 1 }); },

  onConfirmAdd() {
    const { activeProduct, selectedSkuId, modalQty, cart } = this.data;
    const sku = (activeProduct.skus || []).find(s => s.id === selectedSkuId);
    if (!sku) { wx.showToast({ title: '请选择规格', icon: 'none' }); return; }
    const isFirstItem = cart.length === 0;
    const key = `${activeProduct.id}::${sku.id}`;
    const existingIdx = cart.findIndex(item => item.key === key);
    let newCart;
    if (existingIdx >= 0) {
      newCart = cart.map((item, i) =>
        i === existingIdx ? { ...item, quantity: item.quantity + modalQty } : item
      );
    } else {
      newCart = [...cart, {
        key, productId: activeProduct.id, skuId: sku.id, skuName: sku.name,
        title: activeProduct.title, price: sku.price, image: activeProduct.image, quantity: modalQty,
      }];
    }
    this.setData({ showModal: false });
    this._updateGlobalCart(newCart);
    if (isFirstItem) setTimeout(() => this._measureSections(), 350);
    wx.showToast({ title: '已加入', icon: 'success', duration: 1000 });
  },

  onOpenCartDetail() {
    if (this.data.cartTotalQty <= 0) return;
    this.setData({ showCartDetail: true });
  },
  onCloseCartDetail() { this.setData({ showCartDetail: false }); },

  onCartItemDecrease(e) {
    const { key } = e.currentTarget.dataset;
    this._decreaseCartByKey(key);
  },

  _decreaseCartByKey(key) {
    const { cart } = this.data;
    const item = cart.find(i => i.key === key);
    if (!item) return;
    const newCart = item.quantity <= 1
      ? cart.filter(i => i.key !== key)
      : cart.map(i => i.key === key ? { ...i, quantity: i.quantity - 1 } : i);
    this._updateGlobalCart(newCart);
    if (newCart.length === 0) this.setData({ showCartDetail: false });
  },

  onCartItemIncrease(e) {
    const { key } = e.currentTarget.dataset;
    this._updateGlobalCart(
      this.data.cart.map(i => i.key === key ? { ...i, quantity: i.quantity + 1 } : i)
    );
  },

  onClearCart() {
    wx.showModal({
      title: '清空购物车',
      content: '确认移除所有已选商品？',
      confirmColor: '#8F6BE9',
      success: (res) => {
        if (res.confirm) {
          this._updateGlobalCart([]);
          this.setData({ showCartDetail: false });
        }
      },
    });
  },

  preventClose() {},
  onPreventScroll() {},

  onGoCheckout() {
    if (this.data.cartTotalQty <= 0) return;
    this.setData({ showCartDetail: false });
    wx.navigateTo({ url: '/pages/checkout/index' });
  },
  onShareAppMessage() {
    return getShareAppMessage({
      title: shopConfig.orderShareTitle,
      path: '/pages/order/index',
    });
  },
  onShareTimeline() {
    return getShareTimeline({
      title: shopConfig.orderShareTitle,
    });
  },
});
