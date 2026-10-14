const s = require('../../utils/store');
const clearedIdentity = { openid: '', isAdmin: false, verified: false };
Page({
  data: { checked: false, loading: false, error: '', ...clearedIdentity },
  consentChanged(e) {
    const checked = Array.isArray(e.detail.value) && e.detail.value.includes('identity');
    this._identityRequest = (this._identityRequest || 0) + 1;
    this.setData({ checked, loading: false, error: '', ...clearedIdentity });
  },
  async verifyIdentity() {
    if (this.data.loading) return;
    const request = this._identityRequest = (this._identityRequest || 0) + 1;
    this.setData({ error: '', ...clearedIdentity });
    if (!this.data.checked) return this.setData({ error: '请先主动勾选身份核对说明' });
    this.setData({ loading: true });
    try {
      if (typeof wx.requirePrivacyAuthorize !== 'function') throw new Error('请更新微信后再核对店主身份');
      await new Promise((resolve, reject) => wx.requirePrivacyAuthorize({ success: resolve, fail: () => reject(new Error('未完成微信隐私授权，尚未获取身份信息')) }));
      if (request !== this._identityRequest || !this.data.checked) return;
      const identity = await s.cloud('whoami');
      if (request !== this._identityRequest || !this.data.checked) return;
      if (!identity || typeof identity.openid !== 'string' || !identity.openid.trim() || identity.openid.length > 128) throw new Error('身份核对失败，请重试');
      this.setData({ openid: identity.openid, isAdmin: identity.isAdmin === true, verified: true });
    } catch (e) {
      if (request === this._identityRequest) this.setData({ ...clearedIdentity, error: '身份核对未完成。' + (e.message || '请稍后重试') });
    } finally {
      if (request === this._identityRequest) this.setData({ loading: false });
    }
  },
  copyIdentity() {
    if (!this.data.checked || !this.data.verified || !this.data.openid || this.data.loading) return;
    wx.setClipboardData({ data: this.data.openid, fail: () => s.err(new Error('复制失败，请重试')) });
  },
  manage() {
    if (!this.data.checked || !this.data.verified || this.data.isAdmin !== true || this.data.loading) return;
    wx.navigateTo({ url: '/pages/admin/index' });
  },
  privacy() { wx.navigateTo({ url: '/pages/privacy/index' }); },
  onUnload() { this._identityRequest = (this._identityRequest || 0) + 1; this.setData({ checked: false, loading: false, error: '', ...clearedIdentity }); }
});
