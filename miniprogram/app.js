const config = require('./config');
const runtime = require('./utils/runtime');

App({
  globalData: { config, runtime: runtime.getState() },
  async onLaunch() {
    try {
      await runtime.initialize(config, wx);
    } catch (error) {
      if (typeof wx.showModal === 'function') {
        wx.showModal({ title: '暂时无法连接店铺', content: error.message, showCancel: false });
      }
      throw error;
    } finally {
      this.globalData.runtime = runtime.getState();
    }
  }
});
