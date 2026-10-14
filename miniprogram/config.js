const business = require('./utils/business');
module.exports = {
  ...business, mode: 'demo', demoAdminEnabled: false, cloudEnv: '',
  shopName: '示例零售店', supportWeChat: '',
  notice: '折扣、包邮与自取规则仅用于演示',
  pickupLocation: '', pickupHours: ''
};
