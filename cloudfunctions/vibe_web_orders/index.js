const cloud = require('wx-server-sdk');
const { getApp } = require('./db');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const TRANSITIONS = {
  SHIP_ORDER:     { from: ['paid'],       to: 'shipped',  tsField: 'shipped_at' },
  APPROVE_REFUND: { from: ['refunding'],  to: 'refunded', tsField: 'refunded_at' },
};

function money(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function amountFen(value) {
  return Math.round(money(value) * 100);
}

function explicitRefundFailure(payload) {
  const candidates = [payload, payload && payload.data, payload && payload.result].filter(Boolean);
  for (const item of candidates) {
    if (item.errcode !== undefined && item.errcode !== 0) {
      return item.errmsg || item.message || String(item.errcode);
    }
    if (item.code && !['SUCCESS', 'PROCESSING'].includes(item.code) && !item.refund_id && !item.status) {
      return item.message || item.msg || item.code;
    }
    if (item.status && ['ABNORMAL', 'CLOSED'].includes(item.status)) {
      return item.status;
    }
  }
  return '';
}

function isDuplicateLedger(error) {
  const text = String(error && (error.message || error.details || error.code || error));
  return text.includes('Duplicate') || text.includes('ER_DUP_ENTRY') || text.includes('uniq_vibe_wallet_ledger_ref');
}

async function refundWalletOrder(rdb, order, now) {
  const refundAmount = money(order.total_amount);
  if (refundAmount <= 0) return { success: false, error: 'INVALID_REFUND_AMOUNT' };

  const { data: walletRows, error: walletFetchErr } = await rdb
    .from('vibe_member_wallets')
    .select('*')
    .eq('openid', order.openid)
    .limit(1);

  if (walletFetchErr) return { success: false, error: walletFetchErr.message };
  if (!walletRows || !walletRows.length) return { success: false, error: 'WALLET_NOT_FOUND' };

  const wallet = walletRows[0];
  const nextBalance = money(money(wallet.balance) + refundAmount);
  const { error: ledgerErr } = await rdb.from('vibe_wallet_ledger').insert({
    _openid: order.openid,
    openid: order.openid,
    change_type: 'order_refund',
    amount: refundAmount,
    balance_after: nextBalance,
    ref_type: 'order_refund',
    ref_id: order.id,
    note: '订单退款退回会员余额',
    created_at: now,
  });

  if (ledgerErr) {
    if (isDuplicateLedger(ledgerErr)) return { success: true, channel: 'wallet', duplicate: true };
    return { success: false, error: ledgerErr.message };
  }

  const { error: walletUpdateErr } = await rdb
    .from('vibe_member_wallets')
    .update({
      balance: nextBalance,
      total_spent: Math.max(0, money(money(wallet.total_spent) - refundAmount)),
      updated_at: now,
    })
    .eq('openid', order.openid);

  if (walletUpdateErr) return { success: false, error: walletUpdateErr.message };
  return { success: true, channel: 'wallet' };
}

async function refundWechatPayOrder(order) {
  const total = amountFen(order.total_amount);
  if (total <= 0) return { success: false, error: 'INVALID_REFUND_AMOUNT' };
  if (!order.transaction_id) return { success: false, error: 'MISSING_TRANSACTION_ID' };

  try {
    const refundResult = await cloud.callFunction({
      name: 'cloudbase_module',
      data: {
        name: 'wxpay_refund',
        data: {
          transaction_id: order.transaction_id,
          out_refund_no: order.id,
          amount: {
            refund: total,
            total,
            currency: 'CNY',
          },
        },
      },
    });

    if (!refundResult || !refundResult.result) {
      return { success: false, error: 'EMPTY_REFUND_RESPONSE' };
    }

    const failure = explicitRefundFailure(refundResult.result);
    if (failure) {
      console.error('[vibe_web_orders] wxpay refund failed', { orderId: order.id, failure, result: refundResult.result });
      return { success: false, error: 'WXPAY_REFUND_FAILED', detail: failure };
    }

    return { success: true, channel: 'wechat_pay', refund: refundResult.result };
  } catch (err) {
    console.error('[vibe_web_orders] wxpay refund exception', { orderId: order.id, err });
    return { success: false, error: 'WXPAY_REFUND_FAILED', detail: err.message || String(err) };
  }
}

async function executeRefund(rdb, order, now) {
  if (String(order.transaction_id || '').startsWith('wallet_')) {
    return refundWalletOrder(rdb, order, now);
  }
  return refundWechatPayOrder(order);
}

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

function rowToOrder(row) {
  return {
    id:              row.id,
    openid:          row.openid,
    status:          row.status,
    subtotal:        parseFloat(row.subtotal),
    shippingFee:     parseFloat(row.shipping_fee),
    totalAmount:     parseFloat(row.total_amount),
    fulfillmentMode: row.fulfillment_mode,
    addressInfo: row.addr_name ? {
      provinceName: row.addr_province,
      cityName:     row.addr_city,
      countyName:   row.addr_district,
      detailInfo:   row.addr_detail,
      telNumber:    row.addr_phone,
      userName:     row.addr_name,
    } : null,
    remark:            row.remark,
    transactionId:     row.transaction_id,
    createdAt:         row.created_at,
    paidAt:            row.paid_at,
    shippedAt:         row.shipped_at,
    completedAt:       row.completed_at,
    refundRequestedAt: row.refund_requested_at,
    refundedAt:        row.refunded_at,
    items: (row.vibe_order_items || []).map(i => ({
      productId: i.product_id,
      skuId:     i.sku_id,
      title:     i.product_title,
      flavor:    i.sku_name,
      price:     parseFloat(i.price),
      quantity:  i.quantity,
      subtotal:  parseFloat(i.subtotal),
    })),
  };
}

exports.main = async (event) => {
  const { _token, action, status, limit = 20, offset = 0, orderId } = event;
  const rdb = getApp().rdb({ database: process.env.OPEN_SHOP_DATABASE || process.env.MYSQL_DATABASE || 'vibe_shop' });

  const adminUid = await requireAdmin(rdb, _token || '');
  if (!adminUid) return { success: false, error: 'FORBIDDEN' };

  if (action === 'list') {
    let query = rdb.from('vibe_orders').select('*, vibe_order_items(*)');
    if (status) query = query.eq('status', status);
    query = query.order('created_at', { ascending: false }).limit(limit);
    if (offset > 0) query = query.range(offset, offset + limit - 1);
    const { data, error } = await query;
    if (error) return { success: false, error: error.message };
    return { success: true, orders: (data || []).map(rowToOrder) };
  }

  if (action === 'SHIP_ORDER' || action === 'APPROVE_REFUND') {
    if (!orderId) return { success: false, error: 'MISSING_ORDER_ID' };
    const transition = TRANSITIONS[action];

    const { data: rows, error: fetchErr } = await rdb
      .from('vibe_orders')
      .select('id, openid, status, total_amount, transaction_id')
      .eq('id', orderId)
      .limit(1);
    if (fetchErr) return { success: false, error: fetchErr.message };
    if (!rows || rows.length === 0) return { success: false, error: 'ORDER_NOT_FOUND' };

    const order = rows[0];
    const current = order.status;
    if (!transition.from.includes(current)) {
      return { success: false, error: 'INVALID_STATUS_TRANSITION' };
    }

    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    if (action === 'APPROVE_REFUND') {
      const refund = await executeRefund(rdb, order, now);
      if (!refund.success) return refund;
    }

    const { error: updateErr } = await rdb
      .from('vibe_orders')
      .update({ status: transition.to, [transition.tsField]: now, updated_at: now })
      .eq('id', orderId);
    if (updateErr) return { success: false, error: updateErr.message };
    return { success: true };
  }

  return { success: false, error: 'UNKNOWN_ACTION' };
};
