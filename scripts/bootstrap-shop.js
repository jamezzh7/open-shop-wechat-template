const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeFile(filePath, content, dryRun) {
  const rel = path.relative(ROOT, filePath);
  if (dryRun) {
    console.log(`[dry-run] write ${rel}`);
    return;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  console.log(`write ${rel}`);
}

function writeJson(filePath, value, dryRun) {
  writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, dryRun);
}

function requireText(config, key) {
  const value = String(config[key] || '').trim();
  if (!value) throw new Error(`Missing required field: ${key}`);
  return value;
}

function jsString(value) {
  return JSON.stringify(value == null ? '' : value);
}

function envValue(value) {
  return JSON.stringify(String(value == null ? '' : value));
}

function buildProjectConfig(config) {
  const basePath = path.join(ROOT, 'project.config.json');
  const base = fs.existsSync(basePath) ? readJson(basePath) : {};

  return {
    ...base,
    miniprogramRoot: 'miniprogram/',
    cloudfunctionRoot: 'cloudfunctions/',
    appid: config.appid,
    projectname: config.projectName || config.shopId,
    srcMiniprogramRoot: 'miniprogram/',
  };
}

function buildCloudBaseConfig(config) {
  const basePath = path.join(ROOT, 'cloudbaserc.json');
  const base = fs.existsSync(basePath) ? readJson(basePath) : {};

  return {
    ...base,
    envId: config.cloudbaseEnvId,
    functionRoot: 'cloudfunctions',
  };
}

function buildMiniProgramAppConfig(config) {
  const appPath = path.join(ROOT, 'miniprogram/app.json');
  const app = readJson(appPath);
  const externalMiniPrograms = config.externalMiniPrograms || {};
  const navigateToMiniProgramAppIdList = [];

  if (externalMiniPrograms.kuaidi100AppId) {
    navigateToMiniProgramAppIdList.push(externalMiniPrograms.kuaidi100AppId);
  }

  return {
    ...app,
    tabBar: {
      ...app.tabBar,
      selectedColor: config.brandColor || '#8F6BE9',
    },
    window: {
      ...app.window,
      navigationBarTitleText: config.shopName,
    },
    navigateToMiniProgramAppIdList,
  };
}

function buildMiniProgramShopConfig(config) {
  return [
    '// 此文件由 scripts/bootstrap-shop.js 生成。',
    '// 不要在这里放密钥；小程序源码对客户端可见。',
    '',
    'module.exports = {',
    `  shopId: ${jsString(config.shopId)},`,
    `  shopName: ${jsString(config.shopName)},`,
    `  brandColor: ${jsString(config.brandColor || '#8F6BE9')},`,
    `  shareTitle: ${jsString(config.shareTitle || `${config.shopName}｜在线点单`)},`,
    `  pickupStoreName: ${jsString(config.pickupStoreName || config.shopName)},`,
    `  cloudbaseEnvId: ${jsString(config.cloudbaseEnvId)},`,
    `  database: ${jsString(config.database || 'vibe_shop')},`,
    `  homeHeroImage: ${jsString(config.homeHeroImage || '')},`,
    `  paymentOrderDescription: ${jsString(config.paymentOrderDescription || `${config.shopName} 订单`)},`,
    `  rechargeDescription: ${jsString(config.rechargeDescription || `${config.shopName} 会员储值`)},`,
    `  orderShareTitle: ${jsString(config.orderShareTitle || config.shareTitle || `${config.shopName}｜在线点单`)},`,
    `  customerServiceSession: ${jsString(config.customerServiceSession || `${config.shopId}-customer-service`)},`,
    `  customerServiceTitle: ${jsString(config.customerServiceTitle || `${config.shopName} 客服`)},`,
    `  rechargePlans: ${JSON.stringify(config.rechargePlans || [], null, 2).replace(/\n/g, '\n  ')},`,
    `  features: ${JSON.stringify(config.features || {}, null, 2).replace(/\n/g, '\n  ')},`,
    `  externalMiniPrograms: ${JSON.stringify(config.externalMiniPrograms || {}, null, 2).replace(/\n/g, '\n  ')},`,
    '};',
    '',
  ].join('\n');
}

function buildAdminEnv(config) {
  const lines = [
    `VITE_SHOP_NAME=${envValue(config.shopName)}`,
    `VITE_CLOUDBASE_ENV_ID=${envValue(config.cloudbaseEnvId)}`,
    `VITE_CLOUDBASE_REGION=${envValue(config.cloudbaseRegion || 'ap-shanghai')}`,
    'VITE_CLOUDBASE_ACCESS_KEY=',
    '',
  ];
  return lines.join('\n');
}

function printChecklist(config) {
  console.log('\n后续仍需在微信/腾讯控制台完成的事项：');
  console.log('- 确认微信小程序 appid 已创建并可在微信开发者工具登录上传。');
  console.log('- 确认 CloudBase 环境已开通，并已创建关系型数据库。');
  console.log('- 确认微信支付云模板已在云开发控制台安装并配置完成。');
  console.log('- 确认微信支付商户号、证书、回调和支付权限已完成。');
  console.log('- 运行 npm run deploy:functions -- --dry-run 检查需要上传的云函数。');
  console.log(`- 云函数环境变量建议设置 OPEN_SHOP_DATABASE=${config.database || 'vibe_shop'}，OPEN_SHOP_NAME=${config.shopName}。`);
  console.log('- 如需订阅消息，在小程序后台选择模板并回填配置。');
  console.log('- 如需企业微信通知，创建群机器人 webhook 并配置到云函数环境变量。');
  console.log(`\n后台配置已面向 ${config.shopName} 生成；构建后台请进入 admin-web 后运行 npm run build。`);
}

function main() {
  const args = process.argv.slice(2);
  const configArg = args.find(arg => !arg.startsWith('--'));
  const dryRun = args.includes('--dry-run');

  if (!configArg) {
    console.error('用法: npm run bootstrap:shop -- shops/your-shop.local.json [--dry-run]');
    process.exit(1);
  }

  const configPath = path.resolve(ROOT, configArg);
  const config = readJson(configPath);

  requireText(config, 'shopId');
  requireText(config, 'shopName');
  requireText(config, 'appid');
  requireText(config, 'cloudbaseEnvId');

  writeJson(path.join(ROOT, 'project.config.json'), buildProjectConfig(config), dryRun);
  writeJson(path.join(ROOT, 'cloudbaserc.json'), buildCloudBaseConfig(config), dryRun);
  writeJson(path.join(ROOT, 'miniprogram/app.json'), buildMiniProgramAppConfig(config), dryRun);
  writeFile(path.join(ROOT, 'miniprogram/config/shop.js'), buildMiniProgramShopConfig(config), dryRun);
  writeFile(path.join(ROOT, 'admin-web/.env.local'), buildAdminEnv(config), dryRun);
  printChecklist(config);
}

main();
