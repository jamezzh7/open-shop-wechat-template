const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const { getApp } = require('./db');
const { calculateShipping } = require('./shipping');
const { randomUUID } = require('crypto');

exports.main = async (event, context) => {
  const wxCtx = cloud.getWXContext();
  // In production OPENID is always populated; tcb fn invoke (CLI) has no WX context.
  const OPENID = wxCtx.OPENID || event._testOpenid || null;
  const { cartItems, fulfillmentMode, addressInfo, remark } = event;

  if (!OPENID) return { success: false, error: 'Missing OPENID — must be called from WeChat client' };
  if (!cartItems || !cartItems.length) return { success: false, error: 'Empty cart' };
  if (fulfillmentMode === 'delivery' && !addressInfo) {
    return { success: false, error: 'Delivery order requires addressInfo' };
  }

  const rdb = getApp().rdb({ database: process.env.OPEN_SHOP_DATABASE || process.env.MYSQL_DATABASE || 'vibe_shop' });
  const skuIds = cartItems.map(i => i.skuId);

  // Fetch SKUs with product info via PostgREST FK join
  const { data: skuRows, error: skuErr } = await rdb
    .from('vibe_skus')
    .select('id, price, available, name, vibe_products(id, title)')
    .in('id', skuIds);

  if (skuErr) {
    // Fallback: separate product query if FK join syntax not supported
    const { data: skuRowsFallback, error: skuErrFallback } = await rdb
      .from('vibe_skus')
      .select('id, price, available, name, product_id')
      .in('id', skuIds);

    if (skuErrFallback) return { success: false, error: skuErrFallback.message };

    const productIds = [...new Set((skuRowsFallback || []).map(s => s.product_id))];
    const { data: prodRows, error: prodErr } = await rdb
      .from('vibe_products')
      .select('id, title')
      .in('id', productIds);

    if (prodErr) return { success: false, error: prodErr.message };

    const prodMap = {};
    for (const p of (prodRows || [])) prodMap[p.id] = p;

    // Attach product info to sku rows in the expected shape
    for (const sku of (skuRowsFallback || [])) {
      sku.vibe_products = prodMap[sku.product_id] || null;
    }

    return await _createOrder(rdb, OPENID, cartItems, skuRowsFallback, fulfillmentMode, addressInfo, remark);
  }

  return await _createOrder(rdb, OPENID, cartItems, skuRows, fulfillmentMode, addressInfo, remark);
};

async function _createOrder(rdb, OPENID, cartItems, skuRows, fulfillmentMode, addressInfo, remark) {
  const skuMap = {};
  for (const row of (skuRows || [])) skuMap[row.id] = row;

  for (const item of cartItems) {
    if (!skuMap[item.skuId]) return { success: false, error: `SKU not found: ${item.skuId}` };
    if (!skuMap[item.skuId].available) return { success: false, error: `SKU unavailable: ${item.skuId}` };
  }

  let subtotal = 0;
  const verifiedItems = cartItems.map(item => {
    const sku = skuMap[item.skuId];
    const product = sku.vibe_products;
    const itemSubtotal = parseFloat(sku.price) * item.quantity;
    subtotal += itemSubtotal;
    return {
      skuId: sku.id,
      skuName: sku.name,
      productId: product.id,
      productTitle: product.title,
      price: parseFloat(sku.price),
      quantity: item.quantity,
      subtotal: itemSubtotal,
    };
  });

  const { shippingFee } = await calculateShipping(rdb, { fulfillmentMode, addressInfo, subtotal });
  const totalAmount = subtotal + shippingFee;
  const orderId = randomUUID().replace(/-/g, '');
  // MySQL DATETIME requires 'YYYY-MM-DD HH:MM:SS' — not ISO 8601
  const now = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');

  const orderRow = {
    id: orderId,
    openid: OPENID,
    status: 'pending_payment',
    subtotal,
    shipping_fee: shippingFee,
    total_amount: totalAmount,
    fulfillment_mode: fulfillmentMode || 'pickup',
    addr_province: addressInfo?.provinceName || null,
    addr_city: addressInfo?.cityName || null,
    addr_district: addressInfo?.countyName || null,
    addr_detail: addressInfo?.detailInfo || null,
    addr_phone: addressInfo?.telNumber || null,
    addr_name: addressInfo?.userName || null,
    remark: remark || '',
    created_at: now,
    updated_at: now,
  };

  const { error: orderErr } = await rdb.from('vibe_orders').insert(orderRow);
  if (orderErr) return { success: false, error: `Order insert failed: ${orderErr.message}` };

  const itemRows = verifiedItems.map(item => ({
    order_id: orderId,
    product_id: item.productId,
    sku_id: item.skuId,
    product_title: item.productTitle,
    sku_name: item.skuName,
    price: item.price,
    quantity: item.quantity,
    subtotal: item.subtotal,
  }));

  const { error: itemsErr } = await rdb.from('vibe_order_items').insert(itemRows);
  if (itemsErr) {
    // Items insert failed — clean up the order row
    await rdb.from('vibe_orders').delete().eq('id', orderId);
    return { success: false, error: `Items insert failed: ${itemsErr.message}` };
  }

  return {
    success: true,
    orderId,
    totalAmount,
    totalAmountFen: Math.round(totalAmount * 100),
  };
}
