const cloudbase = require('@cloudbase/node-sdk');
let _app = null;
module.exports.getApp = function getApp() {
  if (!_app) {
    const env = process.env.CLOUDBASE_ENV_ID || process.env.TCB_ENV || process.env.SCF_NAMESPACE;
    _app = env ? cloudbase.init({ env }) : cloudbase.init();
  }
  return _app;
};
