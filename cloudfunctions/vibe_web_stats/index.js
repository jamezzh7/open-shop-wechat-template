const { getApp } = require('./db');

function uidFromToken(token) {
  try {
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(b64, 'base64').toString('utf8')).sub || '';
  } catch (_) { return ''; }
}

async function requireAdmin(rdb, token) {
  const uid = uidFromToken(token);
  if (!uid) return null;
  const { data } = await rdb.from('vibe_admins').select('id').eq('web_uid', uid).limit(1);
  return (Array.isArray(data) && data.length > 0) ? uid : null;
}

exports.main = async (event) => {
  const { _token } = event;
  const rdb = getApp().rdb({ database: process.env.OPEN_SHOP_DATABASE || process.env.MYSQL_DATABASE || 'vibe_shop' });

  const adminUid = await requireAdmin(rdb, _token || '');
  if (!adminUid) return { success: false, error: 'FORBIDDEN' };

  const todayStr = new Date().toISOString().slice(0, 10); // "2026-05-18"

  // Weekly range: Monday of current week
  const now = new Date();
  const dayOfWeek = now.getDay() === 0 ? 7 : now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - dayOfWeek + 1);
  monday.setHours(0, 0, 0, 0);
  const mondayStr = monday.toISOString().slice(0, 10);

  const [todayRes, revenueRes, pendingPaidRes, pendingRefundRes, weekRes] = await Promise.all([
    // Today's order count (excluding pending_payment)
    rdb.from('vibe_orders')
      .select('id', { count: 'exact', head: true })
      .neq('status', 'pending_payment')
      .gte('created_at', `${todayStr} 00:00:00`),
    // Today's revenue — fetch total_amount rows, sum in JS
    rdb.from('vibe_orders').select('total_amount').neq('status', 'pending_payment').gte('created_at', `${todayStr} 00:00:00`),
    // Orders pending ship (status=paid)
    rdb.from('vibe_orders').select('id', { count: 'exact', head: true }).eq('status', 'paid'),
    // Orders pending refund (status=refunding)
    rdb.from('vibe_orders').select('id', { count: 'exact', head: true }).eq('status', 'refunding'),
    // This week's orders for daily revenue (Mon-Sun)
    rdb.from('vibe_orders').select('total_amount, created_at')
      .neq('status', 'pending_payment')
      .gte('created_at', `${mondayStr} 00:00:00`),
  ]);

  const todayOrders = todayRes.count ?? (todayRes.data?.length ?? 0);
  const todayRevenue = (revenueRes.data || []).reduce((s, r) => s + parseFloat(r.total_amount), 0);
  const pendingShip = pendingPaidRes.count ?? (pendingPaidRes.data?.length ?? 0);
  const pendingRefund = pendingRefundRes.count ?? (pendingRefundRes.data?.length ?? 0);

  // Build weeklyRevenue [Mon, Tue, Wed, Thu, Fri, Sat, Sun]
  const weeklyRevenue = [0, 0, 0, 0, 0, 0, 0];
  for (const row of (weekRes.data || [])) {
    const d = new Date(row.created_at);
    const dow = d.getDay() === 0 ? 6 : d.getDay() - 1; // 0=Mon, 6=Sun
    weeklyRevenue[dow] += parseFloat(row.total_amount);
  }

  return {
    success: true,
    todayOrders,
    todayRevenue: parseFloat(todayRevenue.toFixed(2)),
    pending: { paid: pendingShip, refunding: pendingRefund },
    weeklyRevenue: weeklyRevenue.map(v => parseFloat(v.toFixed(2))),
  };
};
