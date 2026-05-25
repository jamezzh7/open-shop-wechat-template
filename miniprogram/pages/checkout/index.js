const FALLBACK_SHIPPING_FEE = 10;
const FALLBACK_FREE_SHIPPING_THRESHOLD = 100;
const shopConfig = require('../../config/shop');
const { enableShareMenu, getShareAppMessage, getShareTimeline } = require('../../utils/share');

Page({
  data: {
    items: [],
    subtotalFormatted: '0.00',
    shippingFeeFormatted: '0.00',
    grandTotalFormatted: '0.00',
    shippingIsFree: false,
    shippingPending: false,
    freeShippingLabel: '满100免运费',
    totalQty: 0,
    fulfillmentMode: 'pickup',   // 'pickup' | 'delivery'
    addressInfo: null,
    remark: '',
    submitting: false,
    paymentMethod: 'wechat',
    walletBalance: 0,
    walletBalanceFormatted: '0.00',
    walletUsable: false,
    walletShortageFormatted: '0.00',
    walletPaymentHint: '余额 ¥0.00',
    pickupConfig: {
      storeName: shopConfig.pickupStoreName,
      pickupAddress: '',
      pickupNote: '',
    },
    customerServiceSession: shopConfig.customerServiceSession,
    customerServiceTitle: shopConfig.customerServiceTitle,
  },

  onLoad() {
    enableShareMenu();
    const cart = getApp().globalData.cart || [];
    if (!cart.length) {
      wx.navigateBack();
      return;
    }
    const items = cart.map(item => ({
      ...item,
      subtotal: (item.price * item.quantity).toFixed(2),
    }));
    const subtotal = cart.reduce((s, i) => s + i.price * i.quantity, 0);
    this._subtotal = subtotal;
    this.setData({
      items,
      subtotalFormatted: subtotal.toFixed(2),
      totalQty: cart.reduce((s, i) => s + i.quantity, 0),
    });
    this._computeShipping();
    this._loadWallet();
    this._loadPickupConfig();
  },

  async _loadPickupConfig() {
    try {
      const { result } = await wx.cloud.callFunction({
        name: 'vibe_shipping_quote',
        data: { action: 'getPickupConfig' },
      });

      if (!result || !result.success || !result.pickupConfig) return;

      this.setData({
        pickupConfig: {
          storeName: result.pickupConfig.storeName || shopConfig.pickupStoreName,
          pickupAddress: result.pickupConfig.pickupAddress || '',
          pickupNote: result.pickupConfig.pickupNote || '',
        },
      });
    } catch (err) {
      console.warn('[vibe] pickup config load failed', err);
    }
  },

  async _loadWallet() {
    try {
      const { result } = await wx.cloud.callFunction({
        name: 'vibe_wallet',
        data: { actionType: 'GET_WALLET' },
      });

      if (!result || !result.success) throw new Error(result?.error || 'Wallet load failed');

      const walletBalance = Number(result.wallet?.balance || 0);
      this.setData({
        walletBalance,
        walletBalanceFormatted: walletBalance.toFixed(2),
      });
      this._updateWalletAvailability(undefined, walletBalance);
    } catch (err) {
      this.setData({
        walletBalance: 0,
        walletBalanceFormatted: '0.00',
        walletUsable: false,
        walletShortageFormatted: '0.00',
        walletPaymentHint: '余额 ¥0.00',
      });
    }
  },

  _updateWalletAvailability(totalValue, balanceValue) {
    const total = Number.isFinite(Number(totalValue))
      ? Number(totalValue)
      : Number(this.data.grandTotalFormatted || 0);
    const walletBalance = Number.isFinite(Number(balanceValue))
      ? Number(balanceValue)
      : Number(this.data.walletBalance || 0);
    const walletUsable = total > 0 && walletBalance >= total;
    const patch = {
      walletUsable,
      walletShortageFormatted: Math.max(total - walletBalance, 0).toFixed(2),
      walletPaymentHint: walletUsable
        ? `余额 ¥${walletBalance.toFixed(2)}`
        : `余额 ¥${walletBalance.toFixed(2)} · 还差 ¥${Math.max(total - walletBalance, 0).toFixed(2)}`,
    };

    if (this.data.paymentMethod === 'wallet' && !walletUsable) {
      patch.paymentMethod = 'wechat';
    }

    this.setData(patch);
  },

  async _computeShipping() {
    const { fulfillmentMode, addressInfo } = this.data;
    const subtotal = this._subtotal || 0;

    if (fulfillmentMode !== 'delivery') {
      const grandTotal = subtotal;
      this.setData({
        shippingFeeFormatted: '0.00',
        grandTotalFormatted: grandTotal.toFixed(2),
        shippingIsFree: true,
        shippingPending: false,
        freeShippingLabel: '',
      });
      this._updateWalletAvailability(grandTotal);
      return;
    }

    if (!addressInfo) {
      const grandTotal = subtotal;
      this.setData({
        shippingFeeFormatted: '0.00',
        grandTotalFormatted: grandTotal.toFixed(2),
        shippingIsFree: false,
        shippingPending: true,
        freeShippingLabel: '',
      });
      this._updateWalletAvailability(grandTotal);
      return;
    }

    const quoteSeq = (this._quoteSeq || 0) + 1;
    this._quoteSeq = quoteSeq;
    this.setData({ shippingPending: true });

    try {
      const { result } = await wx.cloud.callFunction({
        name: 'vibe_shipping_quote',
        data: { fulfillmentMode, addressInfo, subtotal },
      });
      if (quoteSeq !== this._quoteSeq) return;
      if (!result || !result.success) throw new Error(result?.error || 'Quote failed');

      const fee = Number(result.shippingFee || 0);
      const threshold = result.freeShippingThreshold;
      const grandTotal = subtotal + fee;
      this.setData({
        shippingFeeFormatted: fee.toFixed(2),
        grandTotalFormatted: grandTotal.toFixed(2),
        shippingIsFree: !!result.shippingIsFree,
        shippingPending: false,
        freeShippingLabel: threshold ? `满${Number(threshold).toFixed(0)}免运费` : '',
      });
      this._updateWalletAvailability(grandTotal);
    } catch (err) {
      if (quoteSeq !== this._quoteSeq) return;
      const fee = subtotal >= FALLBACK_FREE_SHIPPING_THRESHOLD ? 0 : FALLBACK_SHIPPING_FEE;
      const grandTotal = subtotal + fee;
      this.setData({
        shippingFeeFormatted: fee.toFixed(2),
        grandTotalFormatted: grandTotal.toFixed(2),
        shippingIsFree: fee === 0,
        shippingPending: false,
        freeShippingLabel: `满${FALLBACK_FREE_SHIPPING_THRESHOLD}免运费`,
      });
      this._updateWalletAvailability(grandTotal);
      wx.showToast({ title: '运费按默认规则预估', icon: 'none' });
    }
  },

  onSelectPaymentMethod(e) {
    const method = e.currentTarget.dataset.method;
    if (method === 'wallet' && !this.data.walletUsable) {
      wx.showToast({ title: '会员余额不足', icon: 'none' });
      return;
    }
    this.setData({ paymentMethod: method === 'wallet' ? 'wallet' : 'wechat' });
  },

  onSelectFulfillment(e) {
    this.setData({ fulfillmentMode: e.currentTarget.dataset.mode });
    this._computeShipping();
  },

  async onChooseAddress() {
    try {
      const res = await wx.chooseAddress();
      this.setData({ addressInfo: res });
      this._computeShipping();
    } catch (err) {
      // User cancelled — suppress; only toast on unexpected errors
      const msg = err.errMsg || '';
      if (!msg.includes('cancel')) {
        wx.showToast({ title: '地址获取失败', icon: 'none' });
      }
    }
  },

  onRemarkInput(e) {
    this.setData({ remark: e.detail.value });
  },

  async onSubmitOrder() {
    if (this.data.submitting) return;

    const { fulfillmentMode, addressInfo, remark, paymentMethod } = this.data;
    if (fulfillmentMode === 'delivery' && !addressInfo) {
      wx.showToast({ title: '请先选择配送地址', icon: 'none' });
      return;
    }

    this.setData({ submitting: true });
    wx.showLoading({ title: '提交中…', mask: true });

    const cart = getApp().globalData.cart || [];
    // Strip to minimal payload — server recalculates prices and shipping
    const cartItems = cart.map(item => ({
      skuId: item.skuId,
      quantity: item.quantity,
    }));

    let orderId = '';

    try {
      // Step 1: Create vibe_orders record; server validates prices and shipping
      const { result: orderResult } = await wx.cloud.callFunction({
        name: 'vibe_createOrder',
        data: { cartItems, fulfillmentMode, addressInfo: addressInfo || null, remark },
      });

      if (!orderResult || !orderResult.success) {
        throw new Error(orderResult?.error || 'Cloud function returned failure');
      }

      orderId = orderResult.orderId;

      if (paymentMethod === 'wallet') {
        const { result: walletPayResult } = await wx.cloud.callFunction({
          name: 'vibe_wallet',
          data: { actionType: 'PAY_ORDER_WITH_BALANCE', orderId },
        });

        if (!walletPayResult || !walletPayResult.success) {
          const msgMap = {
            INSUFFICIENT_BALANCE: '会员余额不足',
            ORDER_NOT_FOUND: '订单不存在',
            ORDER_NOT_PENDING_PAYMENT: '订单状态已变更',
            FORBIDDEN: '无权支付该订单',
          };
          throw new Error(msgMap[walletPayResult && walletPayResult.error] || 'Wallet payment failed');
        }

        wx.hideLoading();
        this._onPaymentSuccess('余额支付成功');
        return;
      }

      // WeChat Pay out_trade_no limit: string[6,32].
      // CloudBase auto-generated _id is exactly 32 hex chars — use it directly.
      // Appending '-amountFen' would push it over the 32-char limit.
      const { result: payResult } = await wx.cloud.callFunction({
        name: 'wxpayFunctions',
        data: {
          type: 'wxpay_order',
          out_trade_no: orderId,
          total: orderResult.totalAmountFen,
          description: shopConfig.paymentOrderDescription,
        },
      });

      // Official template returns result.data with packageVal (not result.payment)
      const paymentData = payResult?.data;
      if (!paymentData || !paymentData.packageVal) {
        throw new Error('Payment initialization failed');
      }

      wx.hideLoading();

      // Step 3: Native WeChat Pay sheet — rejects on cancel or timeout
      await wx.requestPayment({
        timeStamp: paymentData.timeStamp,
        nonceStr: paymentData.nonceStr,
        package: paymentData.packageVal,
        paySign: paymentData.paySign,
        signType: 'RSA',
      });

      // Step 4 intentionally removed: vibe_pay_callback is the sole authority
      // for transitioning vibe_orders to 'paid'. Client only navigates.
      this._onPaymentSuccess('支付成功！');

    } catch (err) {
      wx.hideLoading();
      const errMsg = err.errMsg || err.message || '';
      const isUserCancel = err.errCode === -1 || errMsg.includes('cancel');

      if (isUserCancel) {
        wx.showToast({ title: '已取消支付', icon: 'none' });
      } else {
        console.error('[vibe] payment failed', { orderId, err });
        wx.showToast({ title: '支付失败，请重试', icon: 'none' });
      }
    } finally {
      this.setData({ submitting: false });
    }
  },

  // ── Payment success handler ───────────────────────────────────

  _onPaymentSuccess(message) {
    getApp().globalData.cart = [];
    wx.showToast({ title: message || '支付成功！', icon: 'success', duration: 1800 });
    setTimeout(() => wx.switchTab({ url: '/pages/orders/index' }), 1800);
  },
  onShareAppMessage() {
    return getShareAppMessage({
      title: shopConfig.shareTitle,
      path: '/pages/order/index',
    });
  },
  onShareTimeline() {
    return getShareTimeline({
      title: shopConfig.shareTitle,
    });
  },
});
