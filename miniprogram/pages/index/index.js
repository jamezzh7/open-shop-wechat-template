const shopConfig = require('../../config/shop');
const { enableShareMenu, getShareAppMessage, getShareTimeline } = require('../../utils/share');

Page({
  data: {
    homeHeroImage: shopConfig.homeHeroImage,
    customerServiceSession: shopConfig.customerServiceSession,
    customerServiceTitle: shopConfig.customerServiceTitle,
  },
  onLoad() {
    enableShareMenu();
  },
  onStartShopping() {
    wx.switchTab({
      url: '/pages/order/index',
    });
  },
  onShareAppMessage() {
    return getShareAppMessage();
  },
  onShareTimeline() {
    return getShareTimeline();
  },
});
