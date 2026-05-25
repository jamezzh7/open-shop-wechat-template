const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const { getApp } = require('./db');

function rowToOrder(row) {
  const items = (row.vibe_order_items || []).map(item => ({
    productId: item.product_id,
    skuId:     item.sku_id,
    title:     item.product_title,
    flavor:    item.sku_name,
    price:     parseFloat(item.price),
    quantity:  item.quantity,
    subtotal:  parseFloat(item.subtotal),
  }));

  return {
    _id:             row.id,
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
    trackingCarrier:   row.tracking_carrier,
    trackingCarrierCode: row.tracking_carrier_code,
    trackingNumber:    row.tracking_number,
    createdAt:         row.created_at,
    paidAt:            row.paid_at,
    shippedAt:         row.shipped_at,
    completedAt:       row.completed_at,
    refundRequestedAt: row.refund_requested_at,
    refundedAt:        row.refunded_at,
    autoCompleted:     !!row.auto_completed,
    items,
  };
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { success: false, error: 'UNAUTHENTICATED' };

  const { adminMode = false, status, statuses, limit = 20, offset = 0 } = event;
  const rdb = getApp().rdb({ database: process.env.OPEN_SHOP_DATABASE || process.env.MYSQL_DATABASE || 'vibe_shop' });

  if (adminMode) {
    const { data: adminCheck } = await rdb.from('vibe_admins').select('id').eq('openid', OPENID).limit(1);
    if (!Array.isArray(adminCheck) || adminCheck.length === 0) {
      return { success: false, error: 'FORBIDDEN' };
    }
  }

  let query = rdb.from('vibe_orders').select('*, vibe_order_items(*)');

  if (adminMode) {
    if (status) query = query.eq('status', status);
    query = query.order('created_at', { ascending: !status });
  } else if (statuses && statuses.length) {
    query = query.eq('openid', OPENID).in('status', statuses).order('created_at', { ascending: false });
  } else {
    query = query.eq('openid', OPENID).order('created_at', { ascending: false });
  }

  query = query.limit(limit);
  if (offset > 0) query = query.range(offset, offset + limit - 1);

  const { data, error } = await query;
  if (error) return { success: false, error: error.message };

  const orders = (data || []).map(rowToOrder);
  return { success: true, orders };
};
