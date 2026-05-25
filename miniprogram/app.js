const shopConfig = require('./config/shop');

App({
  onLaunch() {
    if (!wx.cloud) {
      console.error('Cloud development requires base library 2.2.3 or above.');
      return;
    }
    wx.cloud.init({
      env: shopConfig.cloudbaseEnvId,
      traceUser: true,
    });
  },
  globalData: {
    cart: [],
  },
});
