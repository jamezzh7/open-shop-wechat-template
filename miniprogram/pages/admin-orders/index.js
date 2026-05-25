const { enableShareMenu, getShareAppMessage, getShareTimeline } = require('../../utils/share');

const TABS = [
  { label: '全部',    status: '',                emptyTitle: '暂无订单',      emptySub: '新订单会在这里集中展示' },
  { label: '待付款',  status: 'pending_payment', emptyTitle: '暂无待付款订单', emptySub: '客户提交订单后，会在这里等待付款' },
  { label: '待发货',  status: 'paid',            emptyTitle: '暂无待发货订单', emptySub: '所有付款订单均已完成发货～' },
  { label: '退款',    status: 'refunding',       emptyTitle: '暂无退款申请',  emptySub: '目前没有待处理的退款请求' },
];

const TRACKING_CARRIERS = [
  { name: '顺丰速运', code: 'shunfeng' },
  { name: '京东物流', code: 'jd' },
  { name: 'EMS', code: 'ems' },
  { name: '中国邮政', code: 'youzhengguonei' },
  { name: '中通快递', code: 'zhongtong' },
  { name: '圆通速递', code: 'yuantong' },
  { name: '申通快递', code: 'shentong' },
  { name: '韵达快递', code: 'yunda' },
  { name: '极兔速递', code: 'jtexpress' },
  { name: '德邦快递', code: 'debangkuaidi' },
];

const STATUS_TEXT = {
  pending_payment: '待付款',
  paid:      '已付款',
  preparing: '备货中',
  ready:     '待自提',
  shipped:   '已发货',
  completed: '已完成',
  refunding: '退款中',
  refunded:  '已退款',
};

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
  const addressLine = o.addressInfo
    ? [o.addressInfo.provinceName, o.addressInfo.cityName, o.addressInfo.countyName, o.addressInfo.detailInfo]
        .filter(Boolean).join(' ')
    : '';
  const receiverText = o.addressInfo
    ? [o.addressInfo.userName, o.addressInfo.telNumber].filter(Boolean).join(' ')
    : '';
  return {
    ...o,
    primaryItemTitle:              (o.items && o.items[0] && o.items[0].title) || '未付款订单',
    statusText:                    STATUS_TEXT[o.status] || o.status,
    createdAtFormatted:            formatDateMinute(o.createdAt),
    paidAtFormatted:               formatDateMinute(o.paidAt),
    shippedAtFormatted:            formatDateMinute(o.shippedAt),
    completedAtFormatted:          formatDateMinute(o.completedAt),
    refundRequestedAtFormatted:    formatDateMinute(o.refundRequestedAt),
    refundedAtFormatted:           formatDateMinute(o.refundedAt),
    totalAmountFormatted:          (o.totalAmount || 0).toFixed(2),
    subtotalFormatted:             (o.subtotal    || 0).toFixed(2),
    shippingFeeFormatted:          (o.shippingFee || 0).toFixed(2),
    isDelivery:                    o.fulfillmentMode === 'delivery',
    fulfillmentText:               o.fulfillmentMode === 'delivery' ? '配送' : '自提',
    addressLine,
    receiverText,
    remarkText:                    o.remark || '无',
    transactionText:               o.transactionId || '暂无',
    trackingCarrierText:           o.trackingCarrier || '未填写',
    trackingCarrierCode:           o.trackingCarrierCode || '',
    trackingNumberText:            o.trackingNumber || '未填写',
    hasTracking:                   !!o.trackingNumber,
    items: (o.items || []).map(item => ({
      ...item,
      priceFormatted: (item.price || 0).toFixed(2),
      itemSubtotalFormatted: (
        item.subtotal !== undefined ? item.subtotal : (item.price || 0) * (item.quantity || 1)
      ).toFixed(2),
    })),
  };
}

Page({
  data: {
    tabs: TABS,
    trackingCarriers: TRACKING_CARRIERS,
    activeTab: 0,
    orders: [],
    loading: true,
    processingOrderId: '',   // shared in-flight guard for ship and refund actions
    showAmountSheet: false,
    amountOrderId: '',
    amountOrderTitle: '',
    amountOriginalText: '',
    amountDraft: '',
    amountSaving: false,
    showDetailSheet: false,
    detailOrder: null,
    showTrackingSheet: false,
    trackingOrderId: '',
    trackingOrderTitle: '',
    trackingCarrierIndex: 0,
    trackingCarrierDraft: '',
    trackingCarrierCodeDraft: '',
    trackingNumberDraft: '',
    trackingSaving: false,
  },

  onLoad() {
    enableShareMenu();
    this._loadOrders();
  },

  onShow() {
    this._loadOrders();
  },

  onPullDownRefresh() {
    this._loadOrders().then(() => wx.stopPullDownRefresh());
  },

  onTabTap(e) {
    const tab = parseInt(e.currentTarget.dataset.tab);
    if (tab === this.data.activeTab) return;
    this.setData({ activeTab: tab, orders: [], loading: true, showDetailSheet: false, detailOrder: null });
    this._loadOrders();
  },

  async _loadOrders() {
    this.setData({ loading: true });
    const { activeTab, tabs } = this.data;
    const { status } = tabs[activeTab];

    try {
      const { result } = await wx.cloud.callFunction({
        name: 'vibe_query_orders',
        data: { adminMode: true, status, limit: 20 },
      });
      if (!result.success) throw new Error(result.error || 'query failed');
      const orders = result.orders.map(formatOrder);
      const detailOrder = this.data.showDetailSheet && this.data.detailOrder
        ? (orders.find(order => order._id === this.data.detailOrder._id) || this.data.detailOrder)
        : this.data.detailOrder;
      this.setData({ orders, detailOrder, loading: false });
    } catch (err) {
      console.error('[vibe-admin] load orders failed', err);
      wx.showToast({ title: '加载失败，请重试', icon: 'none' });
      this.setData({ loading: false });
    }
  },

  async onShipOrder(e) {
    const { orderid } = e.currentTarget.dataset;
    if (this.data.processingOrderId) return;
    const order = this.data.orders.find(item => item._id === orderid);
    if (!order) {
      wx.showToast({ title: '订单不存在，请刷新', icon: 'none' });
      return;
    }
    if (order.isDelivery) {
      const carrierIndex = TRACKING_CARRIERS.findIndex(item => item.code === order.trackingCarrierCode);
      const safeCarrierIndex = carrierIndex >= 0 ? carrierIndex : 0;
      this.setData({
        showTrackingSheet: true,
        trackingOrderId: orderid,
        trackingOrderTitle: order.primaryItemTitle,
        trackingCarrierIndex: safeCarrierIndex,
        trackingCarrierDraft: order.trackingCarrier || TRACKING_CARRIERS[safeCarrierIndex].name,
        trackingCarrierCodeDraft: order.trackingCarrierCode || TRACKING_CARRIERS[safeCarrierIndex].code,
        trackingNumberDraft: order.trackingNumber || '',
      });
      return;
    }
    await this._shipOrder({ orderId: orderid });
  },

  async _shipOrder({ orderId, trackingCarrier = '', trackingCarrierCode = '', trackingNumber = '' }) {
    if (this.data.processingOrderId) return;
    this.setData({ processingOrderId: orderId });
    wx.showLoading({ title: '发货中…', mask: true });
    try {
      const result = await wx.cloud.callFunction({
        name: 'vibe_manage_order',
        data: {
          actionType: 'SHIP_ORDER',
          orderId,
          trackingCarrier,
          trackingCarrierCode,
          trackingNumber,
        },
      });
      if (result.result.success) {
        wx.showToast({ title: '已发货', icon: 'success' });
        this.setData({
          showTrackingSheet: false,
          trackingOrderId: '',
          trackingOrderTitle: '',
          trackingCarrierIndex: 0,
          trackingCarrierDraft: '',
          trackingCarrierCodeDraft: '',
          trackingNumberDraft: '',
        });
        this._loadOrders();
      } else {
        const msgMap = {
          FORBIDDEN:                 '权限不足',
          INVALID_STATUS_TRANSITION: '订单状态已变更，请刷新',
          ORDER_NOT_FOUND:           '订单不存在',
          MISSING_TRACKING_NUMBER:   '请填写物流单号',
        };
        wx.showToast({ title: msgMap[result.result.error] || '操作失败', icon: 'none' });
      }
    } catch (err) {
      console.error('[vibe-admin] ship order failed', err);
      wx.showToast({ title: '网络错误，请重试', icon: 'none' });
    } finally {
      wx.hideLoading();
      this.setData({ processingOrderId: '' });
    }
  },

  onTrackingCarrierChange(e) {
    const index = Number(e.detail.value || 0);
    const carrier = TRACKING_CARRIERS[index] || TRACKING_CARRIERS[0];
    this.setData({
      trackingCarrierIndex: index,
      trackingCarrierDraft: carrier.name,
      trackingCarrierCodeDraft: carrier.code,
    });
  },

  onTrackingNumberInput(e) {
    this.setData({ trackingNumberDraft: e.detail.value });
  },

  onCloseTrackingSheet() {
    if (this.data.trackingSaving) return;
    this.setData({
      showTrackingSheet: false,
      trackingOrderId: '',
      trackingOrderTitle: '',
      trackingCarrierIndex: 0,
      trackingCarrierDraft: '',
      trackingCarrierCodeDraft: '',
      trackingNumberDraft: '',
    });
  },

  async onConfirmTrackingShip() {
    if (this.data.trackingSaving || this.data.processingOrderId) return;
    const trackingNumber = String(this.data.trackingNumberDraft || '').trim();
    if (!trackingNumber) {
      wx.showToast({ title: '请填写物流单号', icon: 'none' });
      return;
    }
    const trackingCarrier = String(this.data.trackingCarrierDraft || '').trim();
    const trackingCarrierCode = String(this.data.trackingCarrierCodeDraft || '').trim();
    this.setData({ trackingSaving: true });
    try {
      await this._shipOrder({
        orderId: this.data.trackingOrderId,
        trackingCarrier,
        trackingCarrierCode,
        trackingNumber,
      });
    } finally {
      this.setData({ trackingSaving: false });
    }
  },

  onOpenOrderDetail(e) {
    const { orderid } = e.currentTarget.dataset;
    const detailOrder = this.data.orders.find(order => order._id === orderid);
    if (!detailOrder) {
      wx.showToast({ title: '订单不存在，请刷新', icon: 'none' });
      return;
    }
    this.setData({ showDetailSheet: true, detailOrder });
  },

  onCloseOrderDetail() {
    this.setData({ showDetailSheet: false, detailOrder: null });
  },

  onOpenAdjustAmount(e) {
    const { orderid, amount, title } = e.currentTarget.dataset;
    if (this.data.processingOrderId || this.data.amountSaving) return;
    this.setData({
      showAmountSheet: true,
      amountOrderId: orderid,
      amountOrderTitle: title || '未付款订单',
      amountOriginalText: amount,
      amountDraft: amount,
    });
  },

  onAmountInput(e) {
    this.setData({ amountDraft: e.detail.value });
  },

  onCloseAmountSheet() {
    if (this.data.amountSaving) return;
    this.setData({
      showAmountSheet: false,
      amountOrderId: '',
      amountOrderTitle: '',
      amountOriginalText: '',
      amountDraft: '',
    });
  },

  async onConfirmAdjustAmount() {
    if (this.data.amountSaving) return;

    const nextAmount = Number(this.data.amountDraft);
    if (!Number.isFinite(nextAmount) || nextAmount <= 0 || nextAmount > 99999.99) {
      wx.showToast({ title: '请输入有效金额', icon: 'none' });
      return;
    }

    const roundedAmount = Math.round(nextAmount * 100) / 100;
    this.setData({ amountSaving: true, processingOrderId: this.data.amountOrderId });
    wx.showLoading({ title: '保存中…', mask: true });

    try {
      const result = await wx.cloud.callFunction({
        name: 'vibe_manage_order',
        data: {
          actionType: 'ADJUST_UNPAID_AMOUNT',
          orderId: this.data.amountOrderId,
          totalAmount: roundedAmount,
        },
      });

      if (result.result && result.result.success) {
        wx.showToast({ title: '金额已更新', icon: 'success' });
        this.setData({
          showAmountSheet: false,
          amountOrderId: '',
          amountOrderTitle: '',
          amountOriginalText: '',
          amountDraft: '',
        });
        this._loadOrders();
      } else {
        const msgMap = {
          FORBIDDEN:                  '权限不足',
          INVALID_AMOUNT:            '金额无效',
          ORDER_NOT_FOUND:           '订单不存在',
          ORDER_NOT_PENDING_PAYMENT: '订单已变更，请刷新',
        };
        wx.showToast({ title: msgMap[result.result && result.result.error] || '保存失败', icon: 'none' });
      }
    } catch (err) {
      console.error('[vibe-admin] adjust amount failed', err);
      wx.showToast({ title: '网络错误，请重试', icon: 'none' });
    } finally {
      wx.hideLoading();
      this.setData({ amountSaving: false, processingOrderId: '' });
    }
  },

  onApproveRefund(e) {
    const { orderid } = e.currentTarget.dataset;
    if (this.data.processingOrderId) return;
    wx.showModal({
      title: '同意退款',
      content: '确定同意退款吗？此操作不可逆。',
      confirmText: '确定同意',
      confirmColor: '#EF4444',
      success: async (res) => {
        if (!res.confirm) return;
        this.setData({ processingOrderId: orderid });
        wx.showLoading({ title: '处理中…', mask: true });
        try {
          const result = await wx.cloud.callFunction({
            name: 'vibe_manage_order',
            data: { actionType: 'APPROVE_REFUND', orderId: orderid },
          });
          if (result.result.success) {
            wx.showToast({ title: '退款已批准', icon: 'success' });
            this._loadOrders();
          } else {
            const msgMap = {
              FORBIDDEN:                 '权限不足',
              INVALID_STATUS_TRANSITION: '订单状态已变更，请刷新',
              ORDER_NOT_FOUND:           '订单不存在',
              INVALID_REFUND_AMOUNT:     '退款金额异常',
              MISSING_TRANSACTION_ID:    '缺少支付交易号',
              WXPAY_REFUND_FAILED:       '微信退款失败，请稍后重试',
              EMPTY_REFUND_RESPONSE:     '退款返回异常，请稍后重试',
              WALLET_NOT_FOUND:          '会员钱包不存在',
            };
            wx.showToast({ title: msgMap[result.result.error] || '操作失败', icon: 'none' });
          }
        } catch (err) {
          console.error('[vibe-admin] approve refund failed', err);
          wx.showToast({ title: '网络错误，请重试', icon: 'none' });
        } finally {
          wx.hideLoading();
          this.setData({ processingOrderId: '' });
        }
      },
    });
  },

  preventClose() {},
  onShareAppMessage() {
    return getShareAppMessage();
  },
  onShareTimeline() {
    return getShareTimeline();
  },
});
