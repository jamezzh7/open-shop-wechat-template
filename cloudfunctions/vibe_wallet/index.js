const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const { getApp } = require('./db');
const { randomUUID } = require('crypto');
const { notifyPaidOrder } = require('./order-notify');

const RECHARGE_PLANS = {
  200: { amount: 200, bonus: 0 },
  400: { amount: 400, bonus: 0 },
  600: { amount: 600, bonus: 0 },
};

function nowSql() {
  return new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
}

function money(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function walletDto(row) {
  return {
    balance: money(row?.balance),
    totalStored: money(row?.total_stored),
    totalBonus: money(row?.total_bonus),
    totalSpent: money(row?.total_spent),
    lastRechargeAt: row?.last_recharge_at || null,
  };
}

async function getWalletRow(rdb, openid) {
  const { data, error } = await rdb
    .from('vibe_member_wallets')
    .select('*')
    .eq('openid', openid)
    .limit(1);

  if (error) throw new Error(error.message);
  return data && data.length ? data[0] : null;
}

async function ensureWalletRow(rdb, openid, createdAt) {
  const existing = await getWalletRow(rdb, openid);
  if (existing) return existing;

  const initial = {
    openid,
    _openid: openid,
    balance: 0,
    total_stored: 0,
    total_bonus: 0,
    total_spent: 0,
    created_at: createdAt,
    updated_at: createdAt,
  };

  const { error } = await rdb.from('vibe_member_wallets').insert(initial);
  if (error) {
    const retry = await getWalletRow(rdb, openid);
    if (retry) return retry;
    throw new Error(error.message);
  }

  return initial;
}

async function handleGetWallet(rdb, openid) {
  const wallet = await getWalletRow(rdb, openid);
  return { success: true, wallet: walletDto(wallet) };
}

async function handleCreateRecharge(rdb, openid, amountValue) {
  const amount = Number(amountValue);
  const plan = RECHARGE_PLANS[amount];
  if (!plan) {
    return { success: false, error: 'INVALID_RECHARGE_AMOUNT' };
  }

  const rechargeId = randomUUID().replace(/-/g, '');
  const createdAt = nowSql();
  const creditedAmount = money(plan.amount + plan.bonus);

  const { error } = await rdb.from('vibe_recharge_orders').insert({
    id: rechargeId,
    _openid: openid,
    openid,
    amount: plan.amount,
    bonus: plan.bonus,
    credited_amount: creditedAmount,
    status: 'pending',
    created_at: createdAt,
    updated_at: createdAt,
  });

  if (error) return { success: false, error: error.message };

  return {
    success: true,
    outTradeNo: rechargeId,
    amount: plan.amount,
    bonus: plan.bonus,
    creditedAmount,
    totalAmountFen: Math.round(plan.amount * 100),
  };
}

async function handlePayOrderWithBalance(rdb, openid, orderId) {
  if (!orderId) return { success: false, error: 'MISSING_ORDER_ID' };

  const { data: orderRows, error: orderErr } = await rdb
    .from('vibe_orders')
    .select('id, openid, status, total_amount')
    .eq('id', orderId)
    .limit(1);

  if (orderErr || !orderRows || !orderRows.length) {
    return { success: false, error: 'ORDER_NOT_FOUND' };
  }

  const order = orderRows[0];
  if (order.openid !== openid) return { success: false, error: 'FORBIDDEN' };
  if (order.status !== 'pending_payment') {
    return { success: false, error: 'ORDER_NOT_PENDING_PAYMENT', current: order.status };
  }

  const totalAmount = money(order.total_amount);
  if (totalAmount <= 0) return { success: false, error: 'INVALID_AMOUNT' };

  const timestamp = nowSql();
  const wallet = await ensureWalletRow(rdb, openid, timestamp);
  const currentBalance = money(wallet.balance);
  if (currentBalance < totalAmount) {
    return {
      success: false,
      error: 'INSUFFICIENT_BALANCE',
      balance: currentBalance,
      required: totalAmount,
    };
  }

  const nextBalance = money(currentBalance - totalAmount);
  const { error: ledgerErr } = await rdb.from('vibe_wallet_ledger').insert({
    _openid: openid,
    openid,
    change_type: 'order_payment',
    amount: -totalAmount,
    balance_after: nextBalance,
    ref_type: 'order',
    ref_id: orderId,
    note: '会员余额支付订单',
    created_at: timestamp,
  });

  if (ledgerErr) {
    return { success: false, error: ledgerErr.message };
  }

  const { error: walletErr } = await rdb
    .from('vibe_member_wallets')
    .update({
      balance: nextBalance,
      total_spent: money(money(wallet.total_spent) + totalAmount),
      updated_at: timestamp,
    })
    .eq('openid', openid);

  if (walletErr) return { success: false, error: walletErr.message };

  const { error: updateOrderErr } = await rdb
    .from('vibe_orders')
    .update({
      status: 'paid',
      transaction_id: `wallet_${orderId}`,
      paid_at: timestamp,
      updated_at: timestamp,
    })
    .eq('id', orderId)
    .eq('status', 'pending_payment');

  if (updateOrderErr) return { success: false, error: updateOrderErr.message };

  try {
    await notifyPaidOrder({ cloud, rdb, orderId });
  } catch (notifyErr) {
    console.error('[vibe_wallet] merchant notify failed', { orderId, notifyErr });
  }

  return {
    success: true,
    orderId,
    paidAmount: totalAmount,
    wallet: {
      ...walletDto(wallet),
      balance: nextBalance,
      totalSpent: money(money(wallet.total_spent) + totalAmount),
    },
  };
}

exports.main = async (event, context) => {
  const wxCtx = cloud.getWXContext();
  const openid = wxCtx.OPENID || event._testOpenid || null;
  if (!openid) return { success: false, error: 'UNAUTHENTICATED' };

  const rdb = getApp().rdb({ database: process.env.OPEN_SHOP_DATABASE || process.env.MYSQL_DATABASE || 'vibe_shop' });
  const { actionType } = event;

  try {
    if (actionType === 'GET_WALLET') {
      return await handleGetWallet(rdb, openid);
    }

    if (actionType === 'CREATE_RECHARGE') {
      return await handleCreateRecharge(rdb, openid, event.amount);
    }

    if (actionType === 'PAY_ORDER_WITH_BALANCE') {
      return await handlePayOrderWithBalance(rdb, openid, event.orderId);
    }

    return { success: false, error: 'INVALID_ACTION' };
  } catch (err) {
    console.error('[vibe_wallet] unexpected error', { actionType, err });
    return { success: false, error: err.message || 'WALLET_ERROR' };
  }
};
