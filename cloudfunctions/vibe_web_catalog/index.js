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

function generateProductId() {
  const timePart = Date.now().toString(36);
  const randomPart = Math.random().toString(36).slice(2, 8);
  return `p_${timePart}_${randomPart}`;
}

async function countProductsInCategory(rdb, categoryId) {
  const { data, error } = await rdb
    .from('vibe_products')
    .select('id')
    .eq('category_id', categoryId);

  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data.length : 0;
}

async function deleteProductWithSkus(rdb, productId) {
  const { error: skuError } = await rdb
    .from('vibe_skus')
    .delete()
    .eq('product_id', productId);

  if (skuError) throw new Error(skuError.message);

  const { error: recommendationError } = await rdb
    .from('vibe_product_recommendations')
    .delete()
    .eq('product_id', productId);

  if (recommendationError) throw new Error(recommendationError.message);

  const { error: productError } = await rdb
    .from('vibe_products')
    .delete()
    .eq('id', productId);

  if (productError) throw new Error(productError.message);
}

async function listProductsWithRecommendation(rdb) {
  const [productRes, recommendationRes] = await Promise.all([
    rdb.from('vibe_products').select('*').order('sort', { ascending: true }),
    rdb
      .from('vibe_product_recommendations')
      .select('product_id')
      .eq('category_id', 1)
      .eq('available', 1),
  ]);

  if (productRes.error) return { error: productRes.error };
  if (recommendationRes.error) return { error: recommendationRes.error };

  const recommendedIds = new Set((recommendationRes.data || []).map(row => row.product_id));
  const rows = (productRes.data || []).map(row => ({
    ...row,
    recommended: recommendedIds.has(row.id) ? 1 : 0,
  }));

  return { rows };
}

async function setProductRecommendation(rdb, productId, recommended) {
  if (!productId) return { success: false, error: 'MISSING_ID' };

  const { data: productRows, error: productErr } = await rdb
    .from('vibe_products')
    .select('id')
    .eq('id', productId)
    .limit(1);

  if (productErr) return { success: false, error: productErr.message };
  if (!productRows || !productRows.length) return { success: false, error: 'PRODUCT_NOT_FOUND' };

  const { data: existingRows, error: existingErr } = await rdb
    .from('vibe_product_recommendations')
    .select('id')
    .eq('category_id', 1)
    .eq('product_id', productId)
    .limit(1);

  if (existingErr) return { success: false, error: existingErr.message };

  const nextAvailable = recommended ? 1 : 0;
  if (existingRows && existingRows.length) {
    const { error } = await rdb
      .from('vibe_product_recommendations')
      .update({ available: nextAvailable })
      .eq('id', existingRows[0].id);
    if (error) return { success: false, error: error.message };
    return { success: true };
  }

  if (!recommended) return { success: true };

  const { data: lastRows, error: lastErr } = await rdb
    .from('vibe_product_recommendations')
    .select('sort')
    .eq('category_id', 1)
    .order('sort', { ascending: false })
    .limit(1);

  if (lastErr) return { success: false, error: lastErr.message };
  const nextSort = (lastRows && lastRows.length ? Number(lastRows[0].sort) : 0) + 1;

  const { error } = await rdb.from('vibe_product_recommendations').insert({
    _openid: '',
    category_id: 1,
    product_id: productId,
    sort: nextSort,
    available: 1,
  });

  if (error) return { success: false, error: error.message };
  return { success: true };
}

exports.main = async (event) => {
  const { _token, action, type, id, data: payload } = event;
  const rdb = getApp().rdb({ database: process.env.OPEN_SHOP_DATABASE || process.env.MYSQL_DATABASE || 'vibe_shop' });

  const adminUid = await requireAdmin(rdb, _token || '');
  if (!adminUid) return { success: false, error: 'FORBIDDEN' };

  const TABLE = { categories: 'vibe_categories', products: 'vibe_products', skus: 'vibe_skus' };
  const table = TABLE[type];
  if (!table) return { success: false, error: 'INVALID_TYPE' };

  if (action === 'list') {
    if (type === 'products') {
      const { rows, error } = await listProductsWithRecommendation(rdb);
      if (error) return { success: false, error: error.message };
      return { success: true, rows: rows || [] };
    }

    const { data: rows, error } = await rdb.from(table).select('*').order('sort', { ascending: true });
    if (error) return { success: false, error: error.message };
    return { success: true, rows: rows || [] };
  }

  if (action === 'setRecommendation') {
    if (type !== 'products') return { success: false, error: 'INVALID_TYPE' };
    return setProductRecommendation(rdb, id, !!(payload && payload.recommended));
  }

  if (action === 'create') {
    const nextPayload = { ...(payload || {}) };
    if (type === 'products' && !nextPayload.id) {
      nextPayload.id = generateProductId();
    }

    const { error } = await rdb.from(table).insert(nextPayload);
    if (error) return { success: false, error: error.message };
    return { success: true, id: nextPayload.id };
  }

  if (action === 'update') {
    if (!id) return { success: false, error: 'MISSING_ID' };
    const { error } = await rdb.from(table).update(payload).eq('id', id);
    if (error) return { success: false, error: error.message };
    return { success: true };
  }

  if (action === 'delete') {
    if (!id) return { success: false, error: 'MISSING_ID' };
    // Products: hard delete with child SKUs; SKU delete remains soft delete.
    // Categories: hard delete only when no products still reference them.
    if (type === 'categories') {
      const productCount = await countProductsInCategory(rdb, id);
      if (productCount > 0) {
        return {
          success: false,
          code: 'CATEGORY_IN_USE',
          error: `该分类下还有 ${productCount} 个商品，不能直接删除。请先将这些商品移动到其他分类，或下架/删除相关商品。`,
        };
      }

      const { error } = await rdb.from(table).delete().eq('id', id);
      if (error) return { success: false, error: error.message };
    } else if (type === 'products') {
      try {
        await deleteProductWithSkus(rdb, id);
      } catch (error) {
        return { success: false, error: error.message };
      }
    } else {
      const { error } = await rdb.from(table).update({ available: 0 }).eq('id', id);
      if (error) return { success: false, error: error.message };
    }
    return { success: true };
  }

  return { success: false, error: 'UNKNOWN_ACTION' };
};
