const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const { getApp } = require('./db');
const { calculateShipping } = require('./shipping');

const PICKUP_SETTING_KEY = 'pickup_config';
const DEFAULT_SHOP_NAME = process.env.OPEN_SHOP_NAME || 'Open Shop';
const DEFAULT_PICKUP_CONFIG = {
  storeName: DEFAULT_SHOP_NAME,
  pickupAddress: '',
  pickupNote: '',
};

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizePickupConfig(payload = {}) {
  return {
    storeName: normalizeText(payload.storeName || DEFAULT_PICKUP_CONFIG.storeName).slice(0, 80),
    pickupAddress: normalizeText(payload.pickupAddress).slice(0, 200),
    pickupNote: normalizeText(payload.pickupNote).slice(0, 120),
  };
}

function parsePickupConfig(value) {
  try {
    const parsed = JSON.parse(value || '{}');
    return { ...DEFAULT_PICKUP_CONFIG, ...normalizePickupConfig(parsed) };
  } catch (_) {
    return DEFAULT_PICKUP_CONFIG;
  }
}

async function getPickupConfig(rdb) {
  const { data, error } = await rdb
    .from('vibe_store_settings')
    .select('setting_value')
    .eq('setting_key', PICKUP_SETTING_KEY)
    .limit(1);

  if (error) return { success: false, error: error.message };
  if (!data || !data.length) return { success: true, pickupConfig: DEFAULT_PICKUP_CONFIG };
  return { success: true, pickupConfig: parsePickupConfig(data[0].setting_value) };
}

exports.main = async (event) => {
  const { action, fulfillmentMode = 'pickup', addressInfo = null, subtotal = 0 } = event;
  const rdb = getApp().rdb({ database: process.env.OPEN_SHOP_DATABASE || process.env.MYSQL_DATABASE || 'vibe_shop' });

  if (action === 'getPickupConfig') {
    return getPickupConfig(rdb);
  }

  const subtotalAmount = Number(subtotal || 0);

  if (!Number.isFinite(subtotalAmount) || subtotalAmount < 0) {
    return { success: false, error: 'INVALID_SUBTOTAL' };
  }

  if (fulfillmentMode === 'delivery' && !addressInfo) {
    return { success: false, error: 'MISSING_ADDRESS' };
  }

  const quote = await calculateShipping(rdb, {
    fulfillmentMode,
    addressInfo,
    subtotal: subtotalAmount,
  });

  return {
    success: true,
    shippingFee: quote.shippingFee,
    shippingIsFree: quote.shippingIsFree,
    freeShippingThreshold: quote.freeShippingThreshold,
    matchedRule: quote.matchedRule,
  };
};
