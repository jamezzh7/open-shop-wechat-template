const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const { getApp } = require('./db');
const { notifyPaidOrder } = require('./order-notify');

function money(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function isDuplicateEntry(error) {
  const text = String(error && (error.message || error.details || error.code || error));
  return text.includes('Duplicate') || text.includes('ER_DUP_ENTRY') || text.includes('uniq_vibe_wallet_ledger_ref');
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

async function creditRecharge(rdb, recharge, transactionId, now) {
  if (recharge.status === 'paid') {
    console.log('[vibe_pay_callback] recharge already paid', { rechargeId: recharge.id });
    return true;
  }

  if (recharge.status !== 'pending') {
    console.warn('[vibe_pay_callback] recharge not pending', { rechargeId: recharge.id, status: recharge.status });
    return true;
  }

  const openid = recharge.openid;
  const creditedAmount = money(recharge.credited_amount);
  const wallet = await ensureWalletRow(rdb, openid, now);
  const nextBalance = money(wallet.balance) + creditedAmount;
  const balanceAfter = money(nextBalance);

  const { error: ledgerErr } = await rdb.from('vibe_wallet_ledger').insert({
    _openid: openid,
    openid,
    change_type: 'recharge',
    amount: creditedAmount,
    balance_after: balanceAfter,
    ref_type: 'recharge',
    ref_id: recharge.id,
    note: '会员储值入账',
    created_at: now,
  });

  if (ledgerErr && !isDuplicateEntry(ledgerErr)) {
    console.error('[vibe_pay_callback] recharge ledger insert failed', { rechargeId: recharge.id, error: ledgerErr });
    return false;
  }

  if (!ledgerErr) {
    const { error: walletErr } = await rdb
      .from('vibe_member_wallets')
      .update({
        balance: balanceAfter,
        total_stored: money(money(wallet.total_stored) + money(recharge.amount)),
        total_bonus: money(money(wallet.total_bonus) + money(recharge.bonus)),
        last_recharge_at: now,
        updated_at: now,
      })
      .eq('openid', openid);

    if (walletErr) {
      console.error('[vibe_pay_callback] recharge wallet update failed', { rechargeId: recharge.id, error: walletErr });
      return false;
    }
  }

  const { error: rechargeErr } = await rdb
    .from('vibe_recharge_orders')
    .update({ status: 'paid', transaction_id: transactionId, paid_at: now, updated_at: now })
    .eq('id', recharge.id);

  if (rechargeErr) {
    console.error('[vibe_pay_callback] recharge status update failed', { rechargeId: recharge.id, error: rechargeErr });
    return false;
  }

  console.log('[vibe_pay_callback] recharge credited', { rechargeId: recharge.id, creditedAmount });
  return true;
}

exports.main = async (event, context) => {
  const { event_type, resource } = event;

  if (event_type !== 'TRANSACTION.SUCCESS') {
    console.warn('[vibe_pay_callback] ignored event', { event_type });
    return { code: 'SUCCESS' };
  }

  const outTradeNo    = resource.out_trade_no   || resource.outTradeNo;
  const transactionId = resource.transaction_id  || resource.transactionId;

  if (!outTradeNo) {
    console.error('[vibe_pay_callback] missing out_trade_no', resource);
    return { code: 'SUCCESS' };
  }

  const now = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
  try {
    const rdb = getApp().rdb({ database: process.env.OPEN_SHOP_DATABASE || process.env.MYSQL_DATABASE || 'vibe_shop' });

    const { data: rechargeRows, error: rechargeFetchErr } = await rdb
      .from('vibe_recharge_orders')
      .select('id, openid, amount, bonus, credited_amount, status')
      .eq('id', outTradeNo)
      .limit(1);

    if (rechargeFetchErr) {
      console.warn('[vibe_pay_callback] recharge lookup failed, continuing order lookup', {
        outTradeNo,
        error: rechargeFetchErr,
      });
    } else if (rechargeRows && rechargeRows.length) {
      await creditRecharge(rdb, rechargeRows[0], transactionId, now);
      return { code: 'SUCCESS' };
    }

    let orderId = outTradeNo;

    const { data: paymentRows, error: paymentFetchErr } = await rdb
      .from('vibe_order_payments')
      .select('id, order_id')
      .eq('id', outTradeNo)
      .limit(1);

    if (paymentFetchErr) {
      console.warn('[vibe_pay_callback] payment mapping lookup failed, falling back to order id', {
        outTradeNo,
        error: paymentFetchErr,
      });
    } else if (paymentRows && paymentRows.length) {
      orderId = paymentRows[0].order_id;
    }

    const { error } = await rdb
      .from('vibe_orders')
      .update({ status: 'paid', transaction_id: transactionId, paid_at: now, updated_at: now })
      .eq('id', orderId)
      .eq('status', 'pending_payment');

    if (error) {
      console.error('[vibe_pay_callback] db update failed', { orderId, outTradeNo, error });
    } else {
      if (orderId !== outTradeNo) {
        const { error: paymentUpdateErr } = await rdb
          .from('vibe_order_payments')
          .update({ status: 'paid', transaction_id: transactionId, paid_at: now, updated_at: now })
          .eq('id', outTradeNo);

        if (paymentUpdateErr) {
          console.warn('[vibe_pay_callback] payment mapping update failed', { orderId, outTradeNo, error: paymentUpdateErr });
        }
      }

      console.log('[vibe_pay_callback] order paid or already transitioned', { orderId, outTradeNo });
      try {
        await notifyPaidOrder({ cloud, rdb, orderId });
      } catch (notifyErr) {
        console.error('[vibe_pay_callback] merchant notify failed', { orderId, notifyErr });
      }
    }
  } catch (err) {
    console.error('[vibe_pay_callback] unexpected error', { outTradeNo, err });
  }

  return { code: 'SUCCESS' };
};
