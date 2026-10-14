function parseDiscount(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!/^\d{1,2}(\.\d{1,3})?$/.test(text)) throw new Error('请填写有效折扣，例如8.8；10表示原价');
  const [whole, fraction = ''] = text.split('.');
  const discountBps = Number(whole) * 1000 + Number(fraction.padEnd(3, '0'));
  if (discountBps < 1 || discountBps > 10000) throw new Error('折扣需大于0且不超过10');
  return { enabled: discountBps < 10000, discountBps, title: discountBps === 10000 ? '原价销售' : '全场' + formatDiscount(discountBps) + '折' };
}
function formatDiscount(bps) { return (bps / 1000).toFixed(3).replace(/\.?0+$/, ''); }
function validate(value) {
  if (!value || typeof value.enabled !== 'boolean' || !Number.isInteger(value.discountBps) || value.discountBps < 1 || value.discountBps > 10000) throw new Error('店铺活动配置无效');
  return parseDiscount(value.enabled ? formatDiscount(value.discountBps) : '10');
}
module.exports = { parseDiscount, formatDiscount, validate };
