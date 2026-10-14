const { cents } = require('./inventory');
const TYPES = ['吧唧', '立牌', '卡片', '挂件', '盲盒', '其他周边'];
function text(value, label, max, required = false) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string') throw new Error(label + '格式无效');
  const result = value.trim();
  if (result.length > max || required && !result || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(result)) throw new Error('请填写有效' + label);
  return result;
}
function normalize(draft) {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) throw new Error('商品资料无效');
  const name = text(draft.name, '商品名称', 120, true);
  const group = draft.group || '明谷';
  if (!['明谷', '盲盒'].includes(group)) throw new Error('请选择明谷或盲盒');
  const type = draft.type || (group === '盲盒' ? '盲盒' : '其他周边');
  if (!TYPES.includes(type)) throw new Error('商品分类无效');
  const priceCents = draft.priceCents === undefined ? cents(String(draft.price)) : draft.priceCents;
  if (!Number.isSafeInteger(priceCents) || priceCents < 1 || priceCents > 99999999) throw new Error('商品价格无效');
  if (!Number.isSafeInteger(draft.stock) || draft.stock < 0 || draft.stock > 1000000) throw new Error('库存需为0至1000000之间的整数');
  if (draft.active !== undefined && typeof draft.active !== 'boolean') throw new Error('上架状态无效');
  return { name, group, type, ip: text(draft.ip, 'IP名称', 60), description: text(draft.description, '商品介绍', 1000),
    skuName: text(draft.skuName || '默认款', '款式名称', 60, true), priceCents, stock: draft.stock, active: draft.active !== false };
}
function build(draft, id, image, now = Date.now()) {
  const value = normalize(draft);
  return { id, name: value.name, group: value.group, type: value.type, ip: value.ip, description: value.description,
    image: image || '/assets/placeholder.jpg', gallery: image ? [image] : [], active: value.active && !!image,
    needsReview: !image, isNew: true, skus: [{ id: id + '-default', name: value.skuName, price: value.priceCents, stock: value.stock }],
    createdAt: now, updatedAt: now, source: '店主录入' };
}
module.exports = { TYPES, text, normalize, build };
