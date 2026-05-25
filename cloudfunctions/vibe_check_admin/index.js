const cloud = require('wx-server-sdk');
const { getApp } = require('./db');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { isAdmin: false };
  const { actionType, templateId } = event || {};

  try {
    const app = getApp();
    // app.rdb() returns a PostgREST-style client backed by the SQL database
    // database option scopes the request to the vibe_shop MySQL DB
    const rdb = app.rdb({ database: process.env.OPEN_SHOP_DATABASE || process.env.MYSQL_DATABASE || 'vibe_shop' });

    const { data, error } = await rdb
      .from('vibe_admins')
      .select('id, order_notify_enabled, order_notify_template_id')
      .eq('openid', OPENID)
      .limit(1);

    if (error) {
      console.error('[vibe] vibe_check_admin rdb error:', error);
      return { isAdmin: false };
    }

    const admin = Array.isArray(data) && data.length > 0 ? data[0] : null;
    if (!admin) return { isAdmin: false };

    if (actionType === 'ENABLE_ORDER_NOTIFY') {
      const trimmedTemplateId = String(templateId || '').trim();
      if (!trimmedTemplateId) {
        return { isAdmin: true, success: false, error: 'MISSING_TEMPLATE_ID' };
      }

      const now = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
      const { error: updateError } = await rdb
        .from('vibe_admins')
        .update({
          order_notify_enabled: 1,
          order_notify_template_id: trimmedTemplateId,
          order_notify_subscribed_at: now,
          last_order_notify_error: null,
        })
        .eq('openid', OPENID);

      if (updateError) {
        console.error('[vibe] enable order notify failed:', updateError);
        return { isAdmin: true, success: false, error: updateError.message };
      }

      return { isAdmin: true, success: true, orderNotifyEnabled: true };
    }

    return {
      isAdmin: true,
      orderNotifyEnabled: !!admin.order_notify_enabled,
      orderNotifyTemplateId: admin.order_notify_template_id || '',
    };
  } catch (err) {
    console.error('[vibe] vibe_check_admin unexpected error:', err);
    return { isAdmin: false };
  }
};
