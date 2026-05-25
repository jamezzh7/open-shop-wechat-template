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

function normalizeText(value) {
  return String(value || '').trim();
}

function nowSql() {
  return new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
}

function normalizeMoney(value, fieldName, allowNull = false) {
  if ((value === '' || value == null) && allowNull) return null;
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) {
    throw new Error(`INVALID_${fieldName}`);
  }
  return Number(num.toFixed(2));
}

function normalizePayload(payload = {}) {
  return {
    province: normalizeText(payload.province),
    city: normalizeText(payload.city),
    district: normalizeText(payload.district),
    shipping_fee: normalizeMoney(payload.shipping_fee, 'SHIPPING_FEE'),
    free_shipping_threshold: normalizeMoney(payload.free_shipping_threshold, 'FREE_SHIPPING_THRESHOLD', true),
    enabled: Number(payload.enabled) ? 1 : 0,
    sort: Number.isFinite(Number(payload.sort)) ? Number(payload.sort) : 0,
  };
}

const PICKUP_SETTING_KEY = 'pickup_config';
const DEFAULT_SHOP_NAME = process.env.OPEN_SHOP_NAME || 'Open Shop';
const DEFAULT_PICKUP_CONFIG = {
  storeName: DEFAULT_SHOP_NAME,
  pickupAddress: '',
  pickupNote: '',
};

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

async function updatePickupConfig(rdb, payload) {
  const pickupConfig = normalizePickupConfig(payload);
  if (!pickupConfig.pickupAddress) return { success: false, error: 'MISSING_PICKUP_ADDRESS' };

  const timestamp = nowSql();
  const settingValue = JSON.stringify(pickupConfig);
  const { data, error: fetchErr } = await rdb
    .from('vibe_store_settings')
    .select('setting_key')
    .eq('setting_key', PICKUP_SETTING_KEY)
    .limit(1);

  if (fetchErr) return { success: false, error: fetchErr.message };

  if (data && data.length) {
    const { error } = await rdb
      .from('vibe_store_settings')
      .update({ setting_value: settingValue, updated_at: timestamp })
      .eq('setting_key', PICKUP_SETTING_KEY);
    if (error) return { success: false, error: error.message };
    return { success: true, pickupConfig };
  }

  const { error } = await rdb.from('vibe_store_settings').insert({
    setting_key: PICKUP_SETTING_KEY,
    _openid: '',
    setting_value: settingValue,
    created_at: timestamp,
    updated_at: timestamp,
  });

  if (error) return { success: false, error: error.message };
  return { success: true, pickupConfig };
}

exports.main = async (event) => {
  const { _token, action, id, data: payload } = event;
  const rdb = getApp().rdb({ database: process.env.OPEN_SHOP_DATABASE || process.env.MYSQL_DATABASE || 'vibe_shop' });

  const adminUid = await requireAdmin(rdb, _token || '');
  if (!adminUid) return { success: false, error: 'FORBIDDEN' };

  if (action === 'getPickupConfig') {
    return getPickupConfig(rdb);
  }

  if (action === 'updatePickupConfig') {
    return updatePickupConfig(rdb, payload);
  }

  if (action === 'list') {
    const { data, error } = await rdb
      .from('vibe_shipping_rules')
      .select('*')
      .order('sort', { ascending: true });
    if (error) return { success: false, error: error.message };
    return { success: true, rows: data || [] };
  }

  if (action === 'create') {
    try {
      const data = normalizePayload(payload);
      const { error } = await rdb.from('vibe_shipping_rules').insert(data);
      if (error) return { success: false, error: error.message };
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  if (action === 'update') {
    if (!id) return { success: false, error: 'MISSING_ID' };
    try {
      const data = normalizePayload(payload);
      const { error } = await rdb.from('vibe_shipping_rules').update(data).eq('id', id);
      if (error) return { success: false, error: error.message };
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  if (action === 'delete') {
    if (!id) return { success: false, error: 'MISSING_ID' };
    const { error } = await rdb.from('vibe_shipping_rules').delete().eq('id', id);
    if (error) return { success: false, error: error.message };
    return { success: true };
  }

  return { success: false, error: 'UNKNOWN_ACTION' };
};
