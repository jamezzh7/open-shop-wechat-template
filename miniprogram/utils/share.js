const shopConfig = require('../config/shop');

const DEFAULT_SHARE = {
  title: shopConfig.shareTitle,
  path: '/pages/index/index',
};

function enableShareMenu() {
  if (!wx.showShareMenu) return;
  wx.showShareMenu({
    withShareTicket: true,
    menus: ['shareAppMessage', 'shareTimeline'],
  });
}

function getShareAppMessage(options = {}) {
  return {
    ...DEFAULT_SHARE,
    ...options,
  };
}

function getShareTimeline(options = {}) {
  const share = getShareAppMessage(options);
  return {
    title: share.title,
    query: share.query || '',
    imageUrl: share.imageUrl,
  };
}

module.exports = {
  enableShareMenu,
  getShareAppMessage,
  getShareTimeline,
};
