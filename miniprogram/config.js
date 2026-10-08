const business = require('./utils/business');
module.exports = {
  ...business, mode: 'demo', demoAdminEnabled: false, cloudEnv: '',
  shopName: '示例零售店', supportWeChat: '',
  notice: '示例活动 · 五折与包邮规则仅用于演示',
  pickupLocation: '', pickupHours: ''
};
