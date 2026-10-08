const titles = require('../data/product-titles');
function productTitle(p) {
  const title = Object.prototype.hasOwnProperty.call(titles, p.id) ? titles[p.id] : null;
  return title && title.original === p.name ? title.display : p.name;
}
function lineTitle(line) { return productTitle({ id: line.productId, name: line.name }); }
function sortProducts(products, sort = 'default') {
  return products.map((p, index) => ({ p, index })).sort((a, b) => {
    const availability = Number(b.p.stock > 0) - Number(a.p.stock > 0);
    if (availability) return availability;
    const price = p => Math.min(...p.skus.map(k => k.salePrice));
    if (sort === 'asc' || sort === 'desc') {
      const difference = sort === 'asc' ? price(a.p) - price(b.p) : price(b.p) - price(a.p);
      if (difference) return difference;
    }
    return a.index - b.index;
  }).map(item => item.p);
}
function shippingDescription(policy) {
  const yuan = cents => (cents / 100).toFixed(2).replace(/\.?0+$/, '');
  const pickup = policy.pickupEnabled ? ' · 自取免邮' : '';
  if (!Number.isSafeInteger(policy.freeShipping) || !Number.isSafeInteger(policy.shippingFee) || policy.freeShipping < 0 || policy.shippingFee < 0) return '运费以结算页为准' + pickup;
  if (policy.shippingFee === 0 || policy.freeShipping === 0) return '快递免邮' + pickup;
  const basis = policy.freeShippingBasis === 'original' ? '原价' : '折后';
  return basis + '满' + yuan(policy.freeShipping) + '元包邮 · 不满邮费' + yuan(policy.shippingFee) + '元' + pickup;
}
function shippingProgress(subtotal, count, policy) {
  const threshold = policy.freeShipping;
  if (!count) return { shippingHint: '勾选商品，查看包邮进度', shippingProgress: 0 };
  if (policy.shippingFee === 0 || threshold === 0) return { shippingHint: '快递免邮 · 自取也免邮', shippingProgress: 100 };
  if (!Number.isSafeInteger(threshold) || threshold < 0) return { shippingHint: '运费以结算页为准', shippingProgress: 0 };
  if (subtotal >= threshold) return { shippingHint: '已包邮 · 也可到店自取', shippingProgress: 100 };
  return { shippingHint: '折后还差¥' + ((threshold - subtotal) / 100).toFixed(2) + '包邮', shippingProgress: Math.min(100, Math.max(0, Math.floor(subtotal / threshold * 100))) };
}
function orderSummary(o, statusName) {
  const contact = (o.deliveryMode === 'pickup' ? o.pickupContact : o.address) || {};
  const lines = o.lines || [];
  return { ...o, statusName, preview: lines.slice(0, 3).map(line => ({ ...line, displayName: lineTitle(line) })),
    extraCount: Math.max(0, lines.length - 3), quantity: lines.reduce((n, line) => n + line.qty, 0),
    totalText: (o.total / 100).toFixed(2), contactName: contact.name || '', contactPhone: contact.phone || '',
    dateText: o.createdAt ? new Date(o.createdAt).toLocaleString() : '' };
}
module.exports = { productTitle, lineTitle, sortProducts, shippingDescription, shippingProgress, orderSummary };
