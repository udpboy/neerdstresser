const { get } = require("../db");

const getActiveUserPlan = async (userId) => {
  const row = await get(
    `SELECT up.plan_id, up.expires_at, p.name, p.display_html, p.max_concurrent, p.max_time, p.api_access, p.premium_access, p.price, p.discount
     FROM user_plans up
     JOIN plans p ON p.id = up.plan_id
     WHERE up.user_id = ?`,
    [userId],
  );
  if (!row) return null;
  if (row.expires_at && row.expires_at < Date.now()) return null;
  return {
    id: row.plan_id,
    name: row.name,
    displayHtml: row.display_html,
    maxConcurrent: row.max_concurrent,
    maxTime: row.max_time,
    apiAccess: Boolean(row.api_access),
    premiumAccess: Boolean(row.premium_access),
    expiresAt: row.expires_at || null,
  };
};

module.exports = { getActiveUserPlan };
