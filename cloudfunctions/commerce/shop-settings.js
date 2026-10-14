const promotion = require('./promotion');
const defaults = require('./business');
function missing(error) { return /not exist|not found|不存在/i.test(error && error.message || ''); }
async function read(db) {
  try {
    const result = await db.collection('shop_settings').doc('storefront').get();
    if (!result.data || !result.data.promotion) return { promotion: { ...defaults.promotion }, revision: 0 };
    return { promotion: promotion.validate(result.data.promotion), revision: result.data.updatedAt || 0 };
  } catch (error) {
    if (missing(error)) return { promotion: { ...defaults.promotion }, revision: 0 };
    throw error;
  }
}
async function save(db, discount) {
  const value = promotion.parseDiscount(discount);
  const updatedAt = Date.now();
  await db.collection('shop_settings').doc('storefront').set({ data: { promotion: value, updatedAt } });
  return { promotion: value, revision: updatedAt };
}
module.exports = { read, save, missing };
