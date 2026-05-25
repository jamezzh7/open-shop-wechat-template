const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const { getApp } = require('./db');

const AUTO_RECEIVE_DAYS = 7;

exports.main = async (event, context) => {
  const cutoff = new Date(Date.now() - AUTO_RECEIVE_DAYS * 24 * 60 * 60 * 1000)
    .toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
  const now = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');

  const rdb = getApp().rdb({ database: process.env.OPEN_SHOP_DATABASE || process.env.MYSQL_DATABASE || 'vibe_shop' });

  // Step 1: Find shipped orders past cutoff
  // shipped_at < cutoff OR (shipped_at IS NULL AND updated_at < cutoff)
  const { data: rows, error: fetchErr } = await rdb
    .from('vibe_orders')
    .select('id')
    .eq('status', 'shipped')
    .or(`shipped_at.lt.${cutoff},and(shipped_at.is.null,updated_at.lt.${cutoff})`)
    .limit(50);

  if (fetchErr) {
    console.error('[vibe_cron] fetch error:', fetchErr);
    return { success: false, error: fetchErr.message };
  }

  if (!rows || rows.length === 0) {
    return { success: true, updated: 0 };
  }

  // Step 2: Update each order
  const ids = rows.map(r => r.id);
  let updated = 0;
  for (const id of ids) {
    const { error } = await rdb
      .from('vibe_orders')
      .update({ status: 'completed', completed_at: now, auto_completed: 1, updated_at: now })
      .eq('id', id);
    if (!error) updated++;
  }

  return { success: true, updated };
};
