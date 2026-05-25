const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function parseArgs(argv) {
  const args = {
    dryRun: false,
    only: '',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') args.dryRun = true;
    if (arg === '--only') {
      args.only = argv[i + 1] || '';
      i += 1;
    }
  }

  return args;
}

function resolveFunctions(config, only) {
  const functionRoot = config.functionRoot || 'cloudfunctions';
  const selected = only
    ? new Set(only.split(',').map(item => item.trim()).filter(Boolean))
    : null;

  return (config.functions || [])
    .filter(fn => fn && fn.name)
    .filter(fn => !selected || selected.has(fn.name))
    .map(fn => ({
      ...fn,
      dir: path.join(ROOT, functionRoot, fn.name),
    }));
}

function deployFunction(envId, fn, dryRun) {
  const relDir = path.relative(ROOT, fn.dir);
  const command = ['tcb', 'fn', 'deploy', fn.name, '-e', envId, '--force'];

  if (!fs.existsSync(fn.dir)) {
    console.warn(`跳过 ${fn.name}：目录不存在 ${relDir}`);
    return;
  }

  if (dryRun) {
    console.log(`[dry-run] ${command.join(' ')}`);
    return;
  }

  console.log(`部署 ${fn.name} ...`);
  const result = spawnSync(command[0], command.slice(1), {
    cwd: ROOT,
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    throw new Error(`${fn.name} 部署失败`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const configPath = path.join(ROOT, 'cloudbaserc.json');
  const config = readJson(configPath);
  const envId = String(config.envId || '').trim();

  if (!envId || envId === 'your-cloudbase-env-id') {
    console.error('cloudbaserc.json 缺少 envId，请先运行 npm run bootstrap:shop -- shops/client.local.json');
    process.exit(1);
  }

  const functions = resolveFunctions(config, args.only);
  if (!functions.length) {
    console.error('没有找到需要部署的云函数，请检查 cloudbaserc.json 或 --only 参数。');
    process.exit(1);
  }

  console.log(`目标 CloudBase 环境：${envId}`);
  console.log(`云函数数量：${functions.length}`);

  for (const fn of functions) {
    deployFunction(envId, fn, args.dryRun);
  }

  if (args.dryRun) {
    console.log('\n以上为预览命令。确认无误后去掉 --dry-run 执行部署。');
  } else {
    console.log('\n云函数部署完成。');
  }

  console.log('\n部署后请在云函数环境变量中确认：');
  console.log('- OPEN_SHOP_DATABASE：关系型数据库名，默认 vibe_shop。');
  console.log('- OPEN_SHOP_NAME：店铺名称，用于通知和默认自提名称。');
  console.log('- ORDER_NOTIFY_WEBHOOK_URL：企业微信订单通知 webhook，按需配置。');
}

main();
