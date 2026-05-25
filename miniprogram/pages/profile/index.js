const STORAGE_KEY = 'vibe_userInfo';
const { ORDER_NOTIFY_TEMPLATE_ID } = require('../../config/order-notify');
const shopConfig = require('../../config/shop');
const { enableShareMenu, getShareAppMessage, getShareTimeline } = require('../../utils/share');

const RECHARGE_PLANS = shopConfig.rechargePlans || [];

function formatMoney(value) {
  return Number(value || 0).toFixed(2);
}

function formatPlan(plan) {
  return {
    ...plan,
    bonusText: plan.bonus > 0 ? `赠 ¥${plan.bonus}` : '实充同额',
  };
}

function normalizeDateInput(value) {
  if (value instanceof Date || typeof value === 'number') return value;
  const text = String(value || '').trim();
  return text.includes(' ') && !text.includes('T') ? text.replace(' ', 'T') : text;
}

function formatDateLabel(value) {
  if (!value) return '暂无';
  const date = new Date(normalizeDateInput(value));
  if (Number.isNaN(date.getTime())) return '暂无';
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${month}.${day}`;
}

Page({
  data: {
    isLoggedIn: false,
    avatarUrl: '',
    nickname: '',
    avatarInitial: 'F',
    isAdmin: false,
    // Login sheet
    showLoginSheet: false,
    draftAvatarUrl: '',
    draftNickname: '',
    // Member wallet
    memberBalance: 0,
    memberBalanceFormatted: '0.00',
    totalStored: 0,
    totalStoredFormatted: '0.00',
    lastRechargeText: '暂无',
    rechargePlans: RECHARGE_PLANS.map(formatPlan),
    selectedPlanIndex: 0,
    selectedPlan: formatPlan(RECHARGE_PLANS[0]),
    showRechargeSheet: false,
    recharging: false,
    walletLoading: false,
    orderNotifyEnabled: false,
    orderNotifyLoading: false,
    orderNotifyConfigured: !!ORDER_NOTIFY_TEMPLATE_ID,
    shopName: shopConfig.shopName,
    welcomeText: `欢迎来到 ${shopConfig.shopName}`,
    customerServiceSession: shopConfig.customerServiceSession,
    customerServiceTitle: shopConfig.customerServiceTitle,
  },

  onLoad() {
    enableShareMenu();
    this._loadFromStorage();
    this._loadMemberWallet();
    this._checkAdmin();
  },

  onShow() {
    this._loadFromStorage();
    this._loadMemberWallet();
  },

  async _checkAdmin() {
    try {
      const res = await wx.cloud.callFunction({ name: 'vibe_check_admin' });
      const result = res.result || {};
      this.setData({
        isAdmin: !!result.isAdmin,
        orderNotifyEnabled: !!result.orderNotifyEnabled,
      });
    } catch (_) {
      // Cloud unavailable — portal stays hidden
    }
  },

  _loadFromStorage() {
    try {
      const saved = wx.getStorageSync(STORAGE_KEY);
      if (saved && saved.nickname) {
        this.setData({
          isLoggedIn: true,
          avatarUrl: saved.avatarUrl || '',
          nickname: saved.nickname,
          avatarInitial: saved.nickname[0] || 'F',
        });
      }
    } catch (e) {
      // Storage failure — stay logged out
    }
  },

  async _loadMemberWallet() {
    this.setData({ walletLoading: true });
    try {
      const { result } = await wx.cloud.callFunction({
        name: 'vibe_wallet',
        data: { actionType: 'GET_WALLET' },
      });

      if (!result || !result.success) {
        throw new Error(result?.error || 'Wallet load failed');
      }

      const wallet = result.wallet || {};
      const memberBalance = Number(wallet.balance || 0);
      const totalStored = Number(wallet.totalStored || 0);
      this.setData({
        memberBalance,
        memberBalanceFormatted: formatMoney(memberBalance),
        totalStored,
        totalStoredFormatted: formatMoney(totalStored),
        lastRechargeText: formatDateLabel(wallet.lastRechargeAt),
      });
    } catch (e) {
      this.setData({
        memberBalance: 0,
        memberBalanceFormatted: '0.00',
        totalStored: 0,
        totalStoredFormatted: '0.00',
        lastRechargeText: '暂无',
      });
    } finally {
      this.setData({ walletLoading: false });
    }
  },

  // ── Header tap: only opens sheet when not logged in ──────────
  onHeaderTap() {
    if (this.data.isLoggedIn) return;
    this.setData({ showLoginSheet: true, draftAvatarUrl: '', draftNickname: '' });
  },

  onCloseLoginSheet() {
    this.setData({ showLoginSheet: false });
  },

  // ── Avatar & nickname capture ─────────────────────────────────
  onChooseAvatar(e) {
    this.setData({ draftAvatarUrl: e.detail.avatarUrl });
  },

  onNicknameInput(e) {
    this.setData({ draftNickname: e.detail.value });
  },

  // Safety net: WeChat native suggestion tap may skip bindinput
  onNicknameBlur(e) {
    this.setData({ draftNickname: e.detail.value });
  },

  // ── Confirm login ─────────────────────────────────────────────
  onConfirmLogin() {
    const { draftNickname, draftAvatarUrl } = this.data;
    const nickname = draftNickname.trim();
    if (!nickname) {
      wx.showToast({ title: '请输入昵称', icon: 'none' });
      return;
    }
    const userInfo = { nickname, avatarUrl: draftAvatarUrl };
    wx.setStorageSync(STORAGE_KEY, userInfo);
    this.setData({
      isLoggedIn: true,
      nickname,
      avatarUrl: draftAvatarUrl,
      avatarInitial: nickname[0],
      showLoginSheet: false,
      draftAvatarUrl: '',
      draftNickname: '',
    });
    wx.showToast({ title: '登录成功', icon: 'success', duration: 1200 });
  },

  // ── Member recharge ───────────────────────────────────────────
  onSelectRechargePlan(e) {
    const index = Number(e.currentTarget.dataset.index);
    const selectedPlan = formatPlan(RECHARGE_PLANS[index] || RECHARGE_PLANS[0]);
    this.setData({ selectedPlanIndex: index, selectedPlan });
  },

  onOpenRecharge() {
    if (!this.data.isLoggedIn) {
      wx.showToast({ title: '请先登录会员', icon: 'none' });
      this.setData({ showLoginSheet: true, draftAvatarUrl: '', draftNickname: '' });
      return;
    }
    const plan = RECHARGE_PLANS[this.data.selectedPlanIndex] || RECHARGE_PLANS[0];
    this.setData({
      selectedPlan: formatPlan(plan),
      showRechargeSheet: true,
    });
  },

  onCloseRechargeSheet() {
    if (this.data.recharging) return;
    this.setData({ showRechargeSheet: false });
  },

  async onConfirmRecharge() {
    if (this.data.recharging) return;

    const plan = RECHARGE_PLANS[this.data.selectedPlanIndex] || RECHARGE_PLANS[0];
    this.setData({ recharging: true });

    try {
      const { result: rechargeResult } = await wx.cloud.callFunction({
        name: 'vibe_wallet',
        data: { actionType: 'CREATE_RECHARGE', amount: plan.amount },
      });

      if (!rechargeResult || !rechargeResult.success) {
        const msgMap = {
          INVALID_RECHARGE_AMOUNT: '储值档位异常',
          UNAUTHENTICATED: '请先登录会员',
        };
        throw new Error(msgMap[rechargeResult && rechargeResult.error] || 'Recharge create failed');
      }

      wx.showLoading({ title: '拉起支付…', mask: true });
      const { result: payResult } = await wx.cloud.callFunction({
        name: 'wxpayFunctions',
        data: {
          type: 'wxpay_order',
          out_trade_no: rechargeResult.outTradeNo,
          total: rechargeResult.totalAmountFen,
          description: shopConfig.rechargeDescription,
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

      this.setData({ showRechargeSheet: false });
      wx.showToast({ title: '支付成功，入账中', icon: 'success', duration: 1400 });
      setTimeout(() => this._loadMemberWallet(), 1600);
    } catch (e) {
      wx.hideLoading();
      const errMsg = e.errMsg || e.message || '';
      const isUserCancel = e.errCode === -1 || errMsg.includes('cancel');
      wx.showToast({ title: isUserCancel ? '已取消支付' : '储值失败，请重试', icon: 'none' });
    } finally {
      this.setData({ recharging: false });
    }
  },

  // ── Order grid navigation ─────────────────────────────────────
  onOrderGridTap(e) {
    const tabIndex = e.currentTarget.dataset.tab;
    wx.navigateTo({ url: `/pages/order-list/index?tabIndex=${tabIndex}` });
  },

  // ── Admin portal entrance ──────────────────────────────────────
  onGoAdminOrders() {
    wx.navigateTo({ url: '/pages/admin-orders/index' });
  },

  async onSubscribeOrderNotify() {
    if (this.data.orderNotifyLoading) return;

    if (!ORDER_NOTIFY_TEMPLATE_ID) {
      wx.showModal({
        title: '需要配置模板',
        content: '请先在 miniprogram/config/order-notify.js 填入微信订阅消息模板 ID。',
        showCancel: false,
      });
      return;
    }

    if (!wx.requestSubscribeMessage) {
      wx.showToast({ title: '当前微信版本不支持订阅消息', icon: 'none' });
      return;
    }

    this.setData({ orderNotifyLoading: true });
    try {
      const subscribeResult = await wx.requestSubscribeMessage({
        tmplIds: [ORDER_NOTIFY_TEMPLATE_ID],
      });

      if (subscribeResult[ORDER_NOTIFY_TEMPLATE_ID] !== 'accept') {
        wx.showToast({ title: '未开启订单提醒', icon: 'none' });
        return;
      }

      const { result } = await wx.cloud.callFunction({
        name: 'vibe_check_admin',
        data: {
          actionType: 'ENABLE_ORDER_NOTIFY',
          templateId: ORDER_NOTIFY_TEMPLATE_ID,
        },
      });

      if (!result || !result.success) {
        throw new Error(result && result.error ? result.error : 'ENABLE_NOTIFY_FAILED');
      }

      this.setData({ orderNotifyEnabled: true });
      wx.showToast({ title: '订单提醒已开启', icon: 'success' });
    } catch (err) {
      console.error('[vibe] subscribe order notify failed', err);
      wx.showToast({ title: '开启提醒失败', icon: 'none' });
    } finally {
      this.setData({ orderNotifyLoading: false });
    }
  },

  // ── Modal utilities ───────────────────────────────────────────
  preventClose() {},
  preventScroll() {},
  onShareAppMessage() {
    return getShareAppMessage();
  },
  onShareTimeline() {
    return getShareTimeline();
  },
});
