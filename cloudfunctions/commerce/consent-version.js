const versions = { privacyVersion: '2026-10-08', termsVersion: '2026-10-08' };
function validateConsent(value, now = Date.now()) {
  if (!value || value.privacyVersion !== versions.privacyVersion || value.termsVersion !== versions.termsVersion || value.scope !== 'fulfillment' || !Number.isSafeInteger(value.acceptedAt) || value.acceptedAt <= 0 || value.acceptedAt > now + 60000) throw new Error('请先阅读并同意当前用户服务协议和隐私政策');
  return { ...versions, acceptedAt: value.acceptedAt, scope: 'fulfillment' };
}
module.exports = { ...versions, validateConsent };
