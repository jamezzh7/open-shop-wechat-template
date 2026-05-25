function parseArgs(argv) {
  const args = {
    openid: '',
    webUid: '',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--openid') {
      args.openid = argv[i + 1] || '';
      i += 1;
    } else if (arg === '--web-uid') {
      args.webUid = argv[i + 1] || '';
      i += 1;
    }
  }

  return args;
}

function sqlString(value) {
  if (!value) return 'NULL';
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const openid = String(args.openid || '').trim();
  const webUid = String(args.webUid || '').trim();

  if (!openid && !webUid) {
    console.error('用法: npm run admin:bind-sql -- --openid 小程序OPENID --web-uid 后台用户UID');
    console.error('至少提供一个参数；两个都提供时会绑定同一个管理员。');
    process.exit(1);
  }

  const columns = [];
  const values = [];
  const updates = [];

  if (openid) {
    columns.push('openid');
    values.push(sqlString(openid));
    updates.push('openid = VALUES(openid)');
  }

  if (webUid) {
    columns.push('web_uid');
    values.push(sqlString(webUid));
    updates.push('web_uid = VALUES(web_uid)');
  }

  console.log('复制下面 SQL 到 CloudBase 关系型数据库中执行：\n');
  console.log(`INSERT INTO vibe_admins (${columns.join(', ')})`);
  console.log(`VALUES (${values.join(', ')})`);
  console.log(`ON DUPLICATE KEY UPDATE ${updates.join(', ')};`);
}

main();
