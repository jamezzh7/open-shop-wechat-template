const http = require('http');
const https = require('https');

function nowSql() {
  return new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
}

function formatMoney(value) {
  return Number(value || 0).toFixed(2);
}

function truncate(value, length) {
  const text = String(value || '');
  return text.length > length ? text.slice(0, length) : text;
}

function orderPagePath() {
  return 'pages/admin-orders/index';
}

function orderNotifyWebhookUrl() {
  return String(process.env.ORDER_NOTIFY_WEBHOOK_URL || process.env.WEWORK_ORDER_BOT_WEBHOOK || '').trim();
}

function shopName() {
  return String(process.env.OPEN_SHOP_NAME || 'Open Shop').trim() || 'Open Shop';
}

function postJson(url, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const target = new URL(url);
    const client = target.protocol === 'http:' ? http : https;
    const req = client.request({
      method: 'POST',
      hostname: target.hostname,
      port: target.port || (target.protocol === 'http:' ? 80 : 443),
      path: `${target.pathname}${target.search}`,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 5000,
    }, res => {
      let responseBody = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { responseBody += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`WEBHOOK_HTTP_${res.statusCode}`));
          return;
        }

        try {
          const parsed = JSON.parse(responseBody || '{}');
          if (parsed.errcode && parsed.errcode !== 0) {
            reject(new Error(parsed.errmsg || `WEBHOOK_ERR_${parsed.errcode}`));
            return;
          }
        } catch (_) {
          // Some generic webhooks may not return JSON.
        }

        resolve();
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error('WEBHOOK_TIMEOUT'));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function fetchOrder(rdb, orderId) {
  const { data, error } = await rdb
    .from('vibe_orders')
    .select('id, status, total_amount, fulfillment_mode, paid_at, merchant_notified_at')
    .eq('id', orderId)
    .limit(1);

  if (error) throw new Error(error.message);
  return data && data.length ? data[0] : null;
}

async function fetchOrderItems(rdb, orderId) {
  const { data, error } = await rdb
    .from('vibe_order_items')
    .select('product_title, quantity')
    .eq('order_id', orderId)
    .limit(5);

  if (error) throw new Error(error.message);
  return data || [];
}

async function fetchSubscribedAdmins(rdb) {
  const { data, error } = await rdb
    .from('vibe_admins')
    .select('openid, order_notify_template_id')
    .eq('order_notify_enabled', 1);

  if (error) throw new Error(error.message);
  return (data || []).filter(admin => admin.openid && admin.order_notify_template_id);
}

function buildItemSummary(items) {
  if (!items.length) return '新订单待处理';
  const first = items[0];
  const suffix = items.length > 1 ? `等${items.length}件` : `x${first.quantity || 1}`;
  return truncate(`${first.product_title || '商品'}${suffix}`, 20);
}

function buildMessageData(order, items, notifiedAt) {
  const fulfillmentText = order.fulfillment_mode === 'delivery' ? '待发货' : '待备货';
  return {
    character_string1: { value: truncate(order.id, 32) },
    amount2: { value: `${formatMoney(order.total_amount)}元` },
    phrase3: { value: fulfillmentText },
    time4: { value: order.paid_at || notifiedAt },
    thing5: { value: buildItemSummary(items) },
  };
}

function buildWebhookContent(order, items, notifiedAt) {
  const statusText = order.fulfillment_mode === 'delivery' ? '待发货' : '待备货';
  return [
    `### ${shopName()}新订单`,
    `> 金额：<font color="warning">¥${formatMoney(order.total_amount)}</font>`,
    `> 状态：${statusText}`,
    `> 商品：${buildItemSummary(items)}`,
    `> 支付时间：${order.paid_at || notifiedAt}`,
    `> 订单号：${truncate(order.id, 32)}`,
    '',
    '请打开小程序「商家管理」处理订单。',
  ].join('\n');
}

async function sendWebhookOrder(order, items, notifiedAt) {
  const webhookUrl = orderNotifyWebhookUrl();
  if (!webhookUrl) return false;

  await postJson(webhookUrl, {
    msgtype: 'markdown',
    markdown: {
      content: buildWebhookContent(order, items, notifiedAt),
    },
  });

  return true;
}

async function updateAdminNotifyResult(rdb, openid, fields) {
  await rdb.from('vibe_admins').update(fields).eq('openid', openid);
}

async function updateOrderNotifyResult(rdb, orderId, fields) {
  await rdb.from('vibe_orders').update(fields).eq('id', orderId);
}

async function notifyPaidOrder({ cloud, rdb, orderId }) {
  const notifiedAt = nowSql();
  const order = await fetchOrder(rdb, orderId);
  if (!order || order.status !== 'paid' || order.merchant_notified_at) return;

  const items = await fetchOrderItems(rdb, orderId);
  let webhookError = '';

  try {
    if (await sendWebhookOrder(order, items, notifiedAt)) {
      await updateOrderNotifyResult(rdb, orderId, {
        merchant_notified_at: notifiedAt,
        merchant_notify_error: null,
      });
      return;
    }
  } catch (err) {
    webhookError = truncate(err && (err.message || err), 255);
  }

  const admins = await fetchSubscribedAdmins(rdb);
  if (!admins.length) {
    await updateOrderNotifyResult(rdb, orderId, { merchant_notify_error: webhookError || 'NO_SUBSCRIBED_ADMIN' });
    return;
  }

  const data = buildMessageData(order, items, notifiedAt);
  const errors = webhookError ? [`WEBHOOK:${webhookError}`] : [];
  let sentCount = 0;

  for (const admin of admins) {
    try {
      await cloud.openapi.subscribeMessage.send({
        touser: admin.openid,
        templateId: admin.order_notify_template_id,
        page: orderPagePath(),
        data,
        miniprogramState: 'formal',
        lang: 'zh_CN',
      });

      sentCount += 1;
      await updateAdminNotifyResult(rdb, admin.openid, {
        last_order_notify_at: notifiedAt,
        last_order_notify_error: null,
      });
    } catch (err) {
      const message = truncate(err && (err.errMsg || err.message || err.errcode || err), 255);
      errors.push(`${admin.openid}:${message}`);
      await updateAdminNotifyResult(rdb, admin.openid, {
        last_order_notify_error: message,
      });
    }
  }

  if (sentCount > 0) {
    await updateOrderNotifyResult(rdb, orderId, {
      merchant_notified_at: notifiedAt,
      merchant_notify_error: errors.length ? truncate(errors.join('; '), 255) : null,
    });
    return;
  }

  await updateOrderNotifyResult(rdb, orderId, {
    merchant_notify_error: truncate(errors.join('; ') || 'SEND_FAILED', 255),
  });
}

module.exports = {
  notifyPaidOrder,
};
