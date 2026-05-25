const FALLBACK_RULE = {
  id: 0,
  province: '',
  city: '',
  district: '',
  shipping_fee: 10,
  free_shipping_threshold: 100,
  enabled: 1,
  sort: 999,
};

function normalize(value) {
  return String(value || '').trim();
}

function toMoney(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function toRule(row) {
  return {
    id: Number(row.id || 0),
    province: normalize(row.province),
    city: normalize(row.city),
    district: normalize(row.district),
    shippingFee: toMoney(row.shipping_fee, 0),
    freeShippingThreshold: row.free_shipping_threshold == null
      ? null
      : toMoney(row.free_shipping_threshold, 0),
    enabled: Number(row.enabled) ? 1 : 0,
    sort: Number(row.sort || 0),
  };
}

function matchScore(rule, addressInfo) {
  const province = normalize(addressInfo?.provinceName);
  const city = normalize(addressInfo?.cityName);
  const district = normalize(addressInfo?.countyName);

  if (rule.province && rule.province !== province) return -1;
  if (rule.city && rule.city !== city) return -1;
  if (rule.district && rule.district !== district) return -1;

  let score = 0;
  if (rule.province) score += 1;
  if (rule.city) score += 2;
  if (rule.district) score += 4;
  return score;
}

function pickBestRule(rows, addressInfo) {
  const rules = (rows && rows.length ? rows : [FALLBACK_RULE]).map(toRule);
  let best = null;
  let bestScore = -1;

  for (const rule of rules) {
    if (!rule.enabled) continue;
    const score = matchScore(rule, addressInfo);
    if (score < 0) continue;
    if (
      score > bestScore ||
      (score === bestScore && best && rule.sort < best.sort) ||
      (score === bestScore && best && rule.sort === best.sort && rule.id < best.id)
    ) {
      best = rule;
      bestScore = score;
    }
  }

  return best || toRule(FALLBACK_RULE);
}

async function loadShippingRules(rdb) {
  const { data, error } = await rdb
    .from('vibe_shipping_rules')
    .select('id, province, city, district, shipping_fee, free_shipping_threshold, enabled, sort')
    .eq('enabled', 1)
    .order('sort', { ascending: true });

  if (error) {
    console.warn('[shipping] load rules failed, fallback used', error);
    return [FALLBACK_RULE];
  }
  return data || [];
}

async function calculateShipping(rdb, { fulfillmentMode, addressInfo, subtotal }) {
  if (fulfillmentMode !== 'delivery') {
    return {
      shippingFee: 0,
      shippingIsFree: true,
      freeShippingThreshold: null,
      matchedRule: null,
    };
  }

  const rows = await loadShippingRules(rdb);
  const matchedRule = pickBestRule(rows, addressInfo);
  const threshold = matchedRule.freeShippingThreshold;
  const shippingIsFree = threshold != null && subtotal >= threshold;
  const shippingFee = shippingIsFree ? 0 : matchedRule.shippingFee;

  return {
    shippingFee,
    shippingIsFree,
    freeShippingThreshold: threshold,
    matchedRule,
  };
}

module.exports = {
  calculateShipping,
};
