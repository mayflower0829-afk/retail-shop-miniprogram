const consentVersion = require('./consent-version');
const versions = { privacyVersion: consentVersion.privacyVersion, termsVersion: consentVersion.termsVersion };
const KEY = 'privacy.consent.v1';
function snapshot() {
  const value = wx.getStorageSync(KEY);
  try { return consentVersion.validateConsent(value); } catch (e) { return null; }
}
function hasConsent() { return !!snapshot(); }
function assertConsent() { if (!hasConsent()) throw new Error('请先阅读并同意用户服务协议和隐私政策'); }
function acceptConsent(checked) {
  if (checked !== true) throw new Error('请主动勾选同意后继续');
  const value = { ...versions, acceptedAt: Date.now(), scope: 'fulfillment' };
  wx.setStorageSync(KEY, value);
  return value;
}
async function authorizeAndAccept(checked) {
  if (checked !== true) throw new Error('请主动勾选同意后继续');
  if (typeof wx.requirePrivacyAuthorize === 'function') {
    await new Promise((resolve, reject) => wx.requirePrivacyAuthorize({ success: resolve, fail: () => reject(new Error('未完成微信隐私授权，可以继续浏览商品')) }));
  }
  return acceptConsent(true);
}
function revoke() { wx.removeStorageSync(KEY); }
module.exports = { versions, hasConsent, snapshot, assertConsent, acceptConsent, authorizeAndAccept, revoke };
