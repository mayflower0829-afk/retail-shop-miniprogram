const legal = require('../../data/legal'), privacy = require('../../utils/privacy'), s = require('../../utils/store');
Page({
  data: { demo: s.config.mode === 'demo', updatedAt: legal.updatedAt, accepted: false, sections: legal.privacy.map(([title, body]) => ({ title, body })) },
  onShow() { this.setData({ accepted: privacy.hasConsent() }); },
  terms() { wx.navigateTo({ url: '/pages/terms/index' }); },
  platformPrivacy() { if (typeof wx.openPrivacyContract !== 'function') return s.err(new Error('当前微信版本不支持此入口，请查看本页隐私政策')); wx.openPrivacyContract({ fail: () => s.err(new Error('平台隐私指引暂不可用，请查看本页政策并联系店主')) }); },
  async revoke() { const r = await new Promise(resolve => wx.showModal({ title: '撤回信息填写授权', content: '之后填写地址或自取联系人需要重新同意。已有模拟订单保留，仍可浏览商品。', confirmText: '撤回授权', success: resolve })); if (r.confirm) { privacy.revoke(); this.setData({ accepted: false }); wx.showToast({ title: '已撤回授权', icon: 'none' }); } },
  async clear() { const r = await new Promise(resolve => wx.showModal({ title: '清除本机试用个人信息', content: '将清除本机全部模拟订单、地址和授权记录，试用库存恢复导入初始值。购物车和收藏保留。此操作无法撤销。', confirmText: '确认清除', success: resolve })); if (r.confirm) { try { s.clearPersonalData(); this.setData({ accepted: false }); wx.showToast({ title: '已清除', icon: 'none' }); } catch (e) { s.err(e); } } }
});
