const crypto = require('crypto');
function orderId(openid, token) {
  if (typeof token !== 'string' || !/^[a-zA-Z0-9_-]{8,80}$/.test(token)) throw new Error('下单标识无效');
  return 'T' + crypto.createHash('sha256').update(openid + ':payment-test:' + token).digest('hex').slice(0, 28);
}
function build(openid, token, privacyConsent, now = Date.now()) {
  return {
    id: orderId(openid, token), _openid: openid, token,
    kind: 'payment_test', name: '1分钱微信支付测试',
    lines: [], originalSubtotal: 1, subtotal: 1, discountAmount: 0,
    shippingFee: 0, total: 1, deliveryMode: 'none',
    address: null, pickupContact: null, privacyConsent,
    status: 'pending', lock: '', demo: false,
    createdAt: now, expiresAt: now + 15 * 60 * 1000
  };
}
function isTest(o) { return o && o.kind === 'payment_test'; }
module.exports = { build, orderId, isTest };
