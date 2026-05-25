const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const { getApp } = require('./db');
const { randomUUID } = require('crypto');

const TRANSITIONS = {
  PAY_ORDER:       { from: ['pending_payment'],                       to: 'paid',      adminOnly: false },
  APPLY_REFUND:    { from: ['paid', 'preparing', 'ready', 'shipped'], to: 'refunding', adminOnly: false },
  CONFIRM_RECEIPT: { from: ['shipped'],                               to: 'completed', adminOnly: false },
  SHIP_ORDER:      { from: ['paid'],                                  to: 'shipped',   adminOnly: true  },
  APPROVE_REFUND:  { from: ['refunding'],                             to: 'refunded',  adminOnly: true  },
};

const TIMESTAMP_FIELD = {
  PAY_ORDER:       'paid_at',
  APPLY_REFUND:    'refund_requested_at',
  CONFIRM_RECEIPT: 'completed_at',
  SHIP_ORDER:      'shipped_at',
  APPROVE_REFUND:  'refunded_at',
};

function normalizeAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;

  const rounded = Math.round(amount * 100) / 100;
  if (rounded <= 0 || rounded > 99999.99) return null;
  return rounded;
}

function normalizeText(value, maxLength) {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function nowSql() {
  return new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
}

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

async function isAdmin(rdb, openid) {
  try {
    const { data } = await rdb.from('vibe_admins').select('id').eq('openid', openid).limit(1);
    return Array.isArray(data) && data.length > 0;
  } catch (_) {
    return false;
  }
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
      console.error('[vibe_manage_order] wxpay refund failed', { orderId: order.id, failure, result: refundResult.result });
      return { success: false, error: 'WXPAY_REFUND_FAILED', detail: failure };
    }

    return { success: true, channel: 'wechat_pay', refund: refundResult.result };
  } catch (err) {
    console.error('[vibe_manage_order] wxpay refund exception', { orderId: order.id, err });
    return { success: false, error: 'WXPAY_REFUND_FAILED', detail: err.message || String(err) };
  }
}

async function executeRefund(rdb, order, now) {
  if (String(order.transaction_id || '').startsWith('wallet_')) {
    return refundWalletOrder(rdb, order, now);
  }
  return refundWechatPayOrder(order);
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const { actionType, orderId, totalAmount } = event;

  if (!OPENID)  return { success: false, error: 'UNAUTHENTICATED' };
  if (!orderId) return { success: false, error: 'MISSING_ORDER_ID' };

  const rdb = getApp().rdb({ database: process.env.OPEN_SHOP_DATABASE || process.env.MYSQL_DATABASE || 'vibe_shop' });

  if (actionType === 'CREATE_PAYMENT_ATTEMPT') {
    const { data: rows, error: fetchErr } = await rdb
      .from('vibe_orders')
      .select('id, openid, status, total_amount')
      .eq('id', orderId)
      .limit(1);

    if (fetchErr || !rows || !rows.length) return { success: false, error: 'ORDER_NOT_FOUND' };

    const order = rows[0];
    if (order.openid !== OPENID) {
      return { success: false, error: 'FORBIDDEN' };
    }

    if (order.status !== 'pending_payment') {
      return { success: false, error: 'ORDER_NOT_PENDING_PAYMENT', current: order.status };
    }

    const amount = normalizeAmount(order.total_amount);
    if (amount == null) {
      return { success: false, error: 'INVALID_AMOUNT' };
    }

    const payTradeNo = randomUUID().replace(/-/g, '');
    const now = nowSql();
    const { error: insertErr } = await rdb
      .from('vibe_order_payments')
      .insert({
        id: payTradeNo,
        _openid: OPENID,
        order_id: orderId,
        amount,
        status: 'pending',
        created_at: now,
        updated_at: now,
      });

    if (insertErr) return { success: false, error: insertErr.message };

    return {
      success: true,
      orderId,
      outTradeNo: payTradeNo,
      totalAmount: amount,
      totalAmountFen: Math.round(amount * 100),
    };
  }

  if (actionType === 'ADJUST_UNPAID_AMOUNT') {
    if (!(await isAdmin(rdb, OPENID))) {
      return { success: false, error: 'FORBIDDEN' };
    }

    const nextAmount = normalizeAmount(totalAmount);
    if (nextAmount == null) {
      return { success: false, error: 'INVALID_AMOUNT' };
    }

    const { data: rows, error: fetchErr } = await rdb
      .from('vibe_orders')
      .select('id, status, total_amount')
      .eq('id', orderId)
      .limit(1);

    if (fetchErr || !rows || !rows.length) return { success: false, error: 'ORDER_NOT_FOUND' };

    const order = rows[0];
    if (order.status !== 'pending_payment') {
      return { success: false, error: 'ORDER_NOT_PENDING_PAYMENT', current: order.status };
    }

    const now = nowSql();
    const { error: updateErr } = await rdb
      .from('vibe_orders')
      .update({ total_amount: nextAmount, updated_at: now })
      .eq('id', orderId)
      .eq('status', 'pending_payment');

    if (updateErr) return { success: false, error: updateErr.message };

    return {
      success: true,
      orderId,
      totalAmount: nextAmount,
      previousTotalAmount: parseFloat(order.total_amount),
    };
  }

  const transition = TRANSITIONS[actionType];
  if (!transition) return { success: false, error: 'INVALID_ACTION' };

  if (transition.adminOnly && !(await isAdmin(rdb, OPENID))) {
    return { success: false, error: 'FORBIDDEN' };
  }

  const { data: rows, error: fetchErr } = await rdb
    .from('vibe_orders')
    .select('id, openid, status, fulfillment_mode, total_amount, transaction_id')
    .eq('id', orderId)
    .limit(1);

  if (fetchErr || !rows || !rows.length) return { success: false, error: 'ORDER_NOT_FOUND' };

  const order = rows[0];

  if (!transition.adminOnly && order.openid !== OPENID) {
    return { success: false, error: 'FORBIDDEN' };
  }

  if (!transition.from.includes(order.status)) {
    return { success: false, error: 'INVALID_STATUS_TRANSITION', current: order.status };
  }

  const trackingCarrier = normalizeText(event.trackingCarrier, 100);
  const trackingCarrierCode = normalizeText(event.trackingCarrierCode, 50);
  const trackingNumber = normalizeText(event.trackingNumber, 100);
  if (actionType === 'SHIP_ORDER' && order.fulfillment_mode === 'delivery' && !trackingNumber) {
    return { success: false, error: 'MISSING_TRACKING_NUMBER' };
  }

  const now = nowSql();

  if (actionType === 'APPROVE_REFUND') {
    const refund = await executeRefund(rdb, order, now);
    if (!refund.success) return refund;
  }

  const updateData = { status: transition.to, updated_at: now };
  updateData[TIMESTAMP_FIELD[actionType]] = now;
  if (actionType === 'SHIP_ORDER') {
    updateData.tracking_carrier = trackingCarrier || null;
    updateData.tracking_carrier_code = trackingCarrierCode || null;
    updateData.tracking_number = trackingNumber || null;
  }

  const { error: updateErr } = await rdb.from('vibe_orders').update(updateData).eq('id', orderId);
  if (updateErr) return { success: false, error: updateErr.message };

  return { success: true, newStatus: transition.to };
};
