const s = require('../../utils/store'), config = s.config;
Page({
  data: { shopName: config.shopName, supportWeChat: config.supportWeChat, demo: config.mode === 'demo', orderId: '', promotionTitle: config.promotion.title, shippingText: s.shippingDescription(config) },
  onLoad(q) { if (q.orderId) this.setData({ orderId: q.orderId }); },
  async onShow() { try { const policy=await s.shippingPolicy(); this.setData({ promotionTitle:policy.promotion.title, shippingText: s.shippingDescription(policy) }); } catch (e) { s.err(e); } },
  copyOrder() { wx.setClipboardData({ data: this.data.orderId }); },
  copySupport() {
    if(!this.data.supportWeChat)return wx.showToast({title:'示例项目未配置客服',icon:'none'});
    wx.setClipboardData({
      data: this.data.supportWeChat,
      success() { wx.showToast({ title: '客服微信已复制', icon: 'success' }); },
      fail() { wx.showToast({ title: '复制失败，请手动复制', icon: 'none' }); }
    });
  }
});
