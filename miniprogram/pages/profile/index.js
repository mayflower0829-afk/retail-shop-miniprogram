const s = require('../../utils/store'), ui = require('../../utils/ui');
const emptyCounts = () => ({ pending: 0, paid: 0, shipped: 0, ready_pickup: 0, completed: 0 });
Page({
  data: { demo: s.config.mode === 'demo', shopName: s.config.shopName, count: 0, favoriteCount: 0, isAdmin: false, counts: emptyCounts(), orderError: '' },
  async onShow() {
    ui.resume(this);
    const request = this._profileRequest = (this._profileRequest || 0) + 1;
    this.setData({ isAdmin: false, orderError: '' });
    try { this.setData({ favoriteCount: s.favorites().length }); } catch (e) { this.setData({ favoriteCount: 0 }); }
    const role = async () => {
      try {
        const allowed = await s.isAdmin();
        if (request === this._profileRequest) this.setData({ isAdmin: allowed === true });
      } catch (e) {
        if (request === this._profileRequest) this.setData({ isAdmin: false });
      }
    };
    const orders = async () => {
      try {
        const list = await s.orders(), counts = emptyCounts();
        list.forEach(o => { if (counts[o.status] !== undefined) counts[o.status]++; });
        if (request === this._profileRequest) this.setData({ count: list.length, counts, orderError: '' });
      } catch (e) {
        if (request === this._profileRequest) this.setData({ count: 0, counts: emptyCounts(), orderError: '订单暂时无法加载，点击重试' });
      }
    };
    await Promise.allSettled([role(), orders()]);
  },
  onHide() { ui.suspend(this); },
  onUnload() { ui.suspend(this); this._profileRequest = (this._profileRequest || 0) + 1; },
  retryOrders() { return this.onShow(); },
  adminAccess() { ui.navigate(this, '/pages/admin-access/index'); },
  orders(e) { wx.setStorageSync('orders.filter.v1', e.currentTarget.dataset.status || 'all'); ui.navigate(this, '/pages/orders/index', 'switchTab'); },
  favorites() { wx.setStorageSync('home.filter.v1', '收藏'); ui.navigate(this, '/pages/home/index', 'switchTab'); },
  go(e) {
    if (['admin', 'admin-products'].includes(e.currentTarget.dataset.page) && !this.data.isAdmin) return s.err(new Error('当前用户没有店铺管理权限'));
    ui.navigate(this, '/pages/' + e.currentTarget.dataset.page + '/index');
  }
});
