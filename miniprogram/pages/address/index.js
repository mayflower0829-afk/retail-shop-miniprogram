const s = require('../../utils/store'), privacy = require('../../utils/privacy'), consent = require('../../utils/consent-page');
const empty = { name: '', phone: '', region: [], detail: '', isDefault: false, id: '' };
Page({
  data: { ...consent.data, demo: s.config.mode === 'demo', addresses: [], editing: false, selecting: false, ...empty },
  ...consent.methods,
  onLoad(q) { this.setData({ selecting: q.select === '1' }); this.reload(); },
  onShow() { this.reload(); },
  reload() {
    if (!consent.refresh(this)) { this.setData({ addresses: [], editing: false, ...empty }); return; }
    const addresses = s.addresses();
    this.setData({ addresses });
    if (!addresses.length && !this.data.editing) this.add();
  },
  onConsentGranted() { this.reload(); },
  add() { if (privacy.hasConsent()) this.setData({ ...empty, editing: true }); },
  edit(e) { if (!privacy.hasConsent()) return; const a = this.data.addresses.find(a => a.id === e.currentTarget.dataset.id); if (a) this.setData({ ...a, editing: true }); },
  choose(e) { if (!privacy.hasConsent()) return; if (!this.data.selecting) return this.edit(e); try { s.chooseAddress(e.currentTarget.dataset.id); wx.navigateBack(); } catch (e) { s.err(e); } },
  field(e) { if (!privacy.hasConsent()) return; const key = e.currentTarget.dataset.field; if (['name', 'phone', 'detail'].includes(key)) this.setData({ [key]: e.detail.value }); },
  region(e) { if (privacy.hasConsent()) this.setData({ region: e.detail.value }); },
  markDefault(e) { if (privacy.hasConsent()) this.setData({ isDefault: e.detail.value }); },
  cancel() { this.setData({ editing: false, ...empty }); },
  save() { try { privacy.assertConsent(); s.saveAddress(this.data, { id: this.data.id || undefined, isDefault: this.data.isDefault, select: this.data.selecting }); this.setData({ editing: false, ...empty }); this.reload(); if (this.data.selecting) wx.navigateBack(); else wx.showToast({ title: '地址已保存' }); } catch (e) { s.err(e); } },
  makeDefault(e) { try { privacy.assertConsent(); s.defaultAddress(e.currentTarget.dataset.id); this.reload(); } catch (e) { s.err(e); } },
  async remove(e) { if (!privacy.hasConsent()) return; const id = e.currentTarget.dataset.id; const r = await new Promise(resolve => wx.showModal({ title: '删除收货地址', content: '已提交订单的收货信息不会改变。确定删除这个地址？', success: resolve })); if (r.confirm) { s.deleteAddress(id); this.reload(); } }
});
