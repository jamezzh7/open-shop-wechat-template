const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const { getApp } = require('./db');

exports.main = async (event, context) => {
  try {
    const rdb = getApp().rdb({ database: process.env.OPEN_SHOP_DATABASE || process.env.MYSQL_DATABASE || 'vibe_shop' });

    const [catRes, prodRes, skuRes, recommendationRes] = await Promise.all([
      rdb.from('vibe_categories').select('id, name, sort').order('sort', { ascending: true }),
      rdb.from('vibe_products').select('id, category_id, title, description, image, sort, available').eq('available', 1).order('sort', { ascending: true }),
      rdb.from('vibe_skus').select('id, product_id, name, price, available, sort').eq('available', 1).order('price', { ascending: true }).order('sort', { ascending: true }),
      rdb.from('vibe_product_recommendations').select('category_id, product_id, sort, available').eq('available', 1).order('category_id', { ascending: true }).order('sort', { ascending: true }),
    ]);

    if (catRes.error || prodRes.error || skuRes.error || recommendationRes.error) {
      throw new Error(catRes.error?.message || prodRes.error?.message || skuRes.error?.message || recommendationRes.error?.message);
    }

    const categories = (catRes.data || []).map(r => ({
      _id: r.id, id: r.id, name: r.name, sort: r.sort,
    }));

    const products = (prodRes.data || []).map(r => ({
      _id: r.id, id: r.id,
      categoryId: r.category_id,
      title: r.title, description: r.description, image: r.image,
      sort: r.sort, available: !!r.available,
    }));

    const skus = (skuRes.data || []).map(r => ({
      id: r.id, productId: r.product_id,
      name: r.name, price: parseFloat(r.price),
      available: !!r.available, sort: r.sort,
    }));

    const recommendations = (recommendationRes.data || []).map(r => ({
      categoryId: r.category_id,
      productId: r.product_id,
      sort: r.sort,
      available: !!r.available,
    }));

    return { success: true, categories, products, skus, recommendations };
  } catch (err) {
    console.error('[vibe_catalog] error:', err);
    return { success: false, error: err.message };
  }
};
