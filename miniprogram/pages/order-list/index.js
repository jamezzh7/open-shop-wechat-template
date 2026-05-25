const shopConfig = require('../../config/shop');
const { enableShareMenu, getShareAppMessage, getShareTimeline } = require('../../utils/share');

const TABS = [
  { label: '全部',      statuses: null },
  { label: '待付款',    statuses: ['pending_payment'] },
  { label: '待收货',    statuses: ['paid', 'preparing', 'ready', 'shipped'] },
  { label: '退款/售后', statuses: ['refunding', 'refunded'] },
];

const STATUS_TEXT = {
  pending_payment: '待付款',
  paid:            '已付款',
  preparing:       '制作中',
  ready:           '可取餐',
  shipped:         '配送中',
  completed:       '已完成',
  refunding:       '退款中',
  refunded:        '已退款',
};

function statusBadgeClass(status) {
  if (status === 'pending_payment') return 'badge--pending';
  if (status === 'completed')       return 'badge--done';
  if (status === 'refunding' || status === 'refunded') return 'badge--refund';
  return 'badge--active';
}

function normalizeDateInput(value) {
  if (value instanceof Date || typeof value === 'number') return value;
  const text = String(value || '').trim();
  const match = text.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})(:\d{2}(?:\.\d+)?)?$/);
  return match ? `${match[1]}T${match[2]}${match[3] || ':00'}` : text;
}

function formatDateMinute(value) {
  if (!value && value !== 0) return '';
  const date = new Date(normalizeDateInput(value));
  if (isNaN(date.getTime())) return '';
  const p = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}`;
}

function formatOrder(o) {
  return {
    ...o,
    createdAtFormatted:   formatDateMinute(o.createdAt),
    shippedAtFormatted:   formatDateMinute(o.shippedAt),
    statusText:           STATUS_TEXT[o.status] || o.status,
    statusBadgeClass:     statusBadgeClass(o.status),
    fulfillmentText:      o.fulfillmentMode === 'delivery' ? '配送' : '自提',
    subtotalFormatted:    (o.subtotal    || 0).toFixed(2),
    shippingFeeFormatted: (o.shippingFee || 0).toFixed(2),
    totalAmountFormatted: (o.totalAmount || 0).toFixed(2),
    totalAmountFen:       Math.round((o.totalAmount || 0) * 100),
    canPay:               o.status === 'pending_payment',
    canRefund:           ['paid', 'preparing', 'ready', 'shipped'].includes(o.status),
    canConfirmReceipt:   o.status === 'shipped',
    isDelivery:           o.fulfillmentMode === 'delivery',
    trackingCarrierText:  o.trackingCarrier || '物流',
    trackingNumberText:   o.trackingNumber || '',
    hasTracking:          !!o.trackingNumber,
    items: (o.items || []).map(item => ({
      ...item,
      itemSubtotalFormatted: (
        item.subtotal !== undefined
          ? item.subtotal
          : (item.price || 0) * (item.quantity || 1)
      ).toFixed(2),
    })),
  };
}

Page({
  data: {
    activeTab: 0,
    tabs: TABS,
    orders: [],
    loading: true,
    processingPaymentId: '',
    customerServiceSession: shopConfig.customerServiceSession,
    customerServiceTitle: shopConfig.customerServiceTitle,
  },

  onLoad(options) {
    enableShareMenu();
    const tabIndex = Math.min(parseInt(options.tabIndex || 0), TABS.length - 1);
    this.setData({ activeTab: tabIndex });
    this._loadOrders();
  },

  onTabTap(e) {
    const tab = parseInt(e.currentTarget.dataset.tab);
    if (tab === this.data.activeTab) return;
    this.setData({ activeTab: tab, orders: [], loading: true });
    this._loadOrders();
  },

  async onApplyRefund(e) {
    const { orderid } = e.currentTarget.dataset;
    wx.showModal({
      title: '申请退款',
      content: '确认申请退款？退款申请提交后将由客服跟进处理。',
      confirmText: '确认申请',
      confirmColor: '#EF4444',
      success: async (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '提交中…', mask: true });
        try {
          const result = await wx.cloud.callFunction({
            name: 'vibe_manage_order',
            data: { actionType: 'APPLY_REFUND', orderId: orderid },
          });
          if (result.result.success) {
            wx.showToast({ title: '退款申请已提交', icon: 'success' });
            this._loadOrders();
          } else {
            wx.showToast({ title: '操作失败，请重试', icon: 'none' });
          }
        } catch (err) {
          console.error('[vibe] apply refund failed', err);
          wx.showToast({ title: '网络错误，请重试', icon: 'none' });
        } finally {
          wx.hideLoading();
        }
      },
    });
  },

  async onPayOrder(e) {
    const { orderid, totalfen } = e.currentTarget.dataset;
    if (this.data.processingPaymentId) return;

    const total = Number(totalfen);
    if (!orderid || !Number.isFinite(total) || total <= 0) {
      wx.showToast({ title: '订单金额异常', icon: 'none' });
      return;
    }

    this.setData({ processingPaymentId: orderid });
    wx.showLoading({ title: '拉起支付…', mask: true });

    try {
      const { result: attemptResult } = await wx.cloud.callFunction({
        name: 'vibe_manage_order',
        data: { actionType: 'CREATE_PAYMENT_ATTEMPT', orderId: orderid },
      });

      if (!attemptResult || !attemptResult.success) {
        const msgMap = {
          FORBIDDEN:                  '无权支付该订单',
          INVALID_AMOUNT:            '订单金额异常',
          ORDER_NOT_FOUND:           '订单不存在',
          ORDER_NOT_PENDING_PAYMENT: '订单状态已变更',
        };
        throw new Error(msgMap[attemptResult && attemptResult.error] || 'Payment attempt failed');
      }

      const { result: payResult } = await wx.cloud.callFunction({
        name: 'wxpayFunctions',
        data: {
          type: 'wxpay_order',
          out_trade_no: attemptResult.outTradeNo,
          total: attemptResult.totalAmountFen || total,
          description: shopConfig.paymentOrderDescription,
        },
      });

      const paymentData = payResult && payResult.data;
      if (!paymentData || !paymentData.packageVal) {
        const rawMessage = payResult && (payResult.errmsg || payResult.message);
        throw new Error(rawMessage || 'Payment initialization failed');
      }

      wx.hideLoading();
      await wx.requestPayment({
        timeStamp: paymentData.timeStamp,
        nonceStr: paymentData.nonceStr,
        package: paymentData.packageVal,
        paySign: paymentData.paySign,
        signType: 'RSA',
      });

      wx.showToast({ title: '支付成功', icon: 'success', duration: 1600 });
      setTimeout(() => this._loadOrders(), 1600);
    } catch (err) {
      wx.hideLoading();
      const errMsg = err.errMsg || err.message || '';
      const isUserCancel = err.errCode === -1 || errMsg.indexOf('cancel') !== -1;
      if (isUserCancel) {
        wx.showToast({ title: '已取消支付', icon: 'none' });
      } else {
        console.error('[vibe] pending order payment failed', { orderId: orderid, err });
        wx.showToast({ title: '支付失败，请重试', icon: 'none' });
      }
    } finally {
      this.setData({ processingPaymentId: '' });
    }
  },

  async onConfirmReceipt(e) {
    const { orderid } = e.currentTarget.dataset;
    wx.showModal({
      title: '确认收货',
      content: '确认已收到商品？确认后订单将完成，不可撤销。',
      confirmText: '确认收货',
      confirmColor: '#8F6BE9',
      success: async (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '处理中…', mask: true });
        try {
          const result = await wx.cloud.callFunction({
            name: 'vibe_manage_order',
            data: { actionType: 'CONFIRM_RECEIPT', orderId: orderid },
          });
          if (result.result.success) {
            wx.showToast({ title: '已确认收货', icon: 'success' });
            this._loadOrders();
          } else {
            wx.showToast({ title: '操作失败，请重试', icon: 'none' });
          }
        } catch (err) {
          console.error('[vibe] confirm receipt failed', err);
          wx.showToast({ title: '网络错误，请重试', icon: 'none' });
        } finally {
          wx.hideLoading();
        }
      },
    });
  },

  onCopyTrackingNumber(e) {
    const { trackingnumber } = e.currentTarget.dataset;
    if (!trackingnumber) return;
    wx.setClipboardData({
      data: trackingnumber,
      success: () => wx.showToast({ title: '单号已复制', icon: 'success' }),
    });
  },

  async onOpenTrackingDetail(e) {
    const { orderid } = e.currentTarget.dataset;
    const order = this.data.orders.find(item => item._id === orderid);
    if (!order || !order.hasTracking) return;

    const trackingNumber = order.trackingNumberText;
    const carrierCode = order.trackingCarrierCode || '';
    const path = `pages/result/result?nu=${encodeURIComponent(trackingNumber)}${carrierCode ? `&com=${encodeURIComponent(carrierCode)}` : ''}&querysource=third_xcx`;

    wx.setClipboardData({
      data: trackingNumber,
      success: () => {
        wx.navigateToMiniProgram({
          appId: shopConfig.externalMiniPrograms.kuaidi100AppId,
          path,
          fail: (err) => {
            console.error('[vibe] open kuaidi100 failed', err);
            wx.showModal({
              title: '单号已复制',
              content: '暂时无法打开快递100小程序，请在微信搜索“快递100”后粘贴单号查询。',
              showCancel: false,
              confirmColor: '#8F6BE9',
            });
          },
        });
      },
    });
  },

  preventClose() {},

  async _loadOrders() {
    this.setData({ loading: true });
    const { activeTab } = this.data;
    const tabStatuses = TABS[activeTab].statuses;

    try {
      const { result } = await wx.cloud.callFunction({
        name: 'vibe_query_orders',
        data: { statuses: tabStatuses, limit: 20 },
      });
      if (!result.success) throw new Error(result.error || 'query failed');
      this.setData({ orders: result.orders.map(formatOrder), loading: false });
    } catch (err) {
      console.error('[vibe] orders tab load failed', err);
      wx.showToast({ title: '加载失败，请重试', icon: 'none' });
      this.setData({ loading: false });
    }
  },
  onShareAppMessage() {
    return getShareAppMessage();
  },
  onShareTimeline() {
    return getShareTimeline();
  },
});
