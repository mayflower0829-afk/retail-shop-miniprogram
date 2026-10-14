const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const consent = require('../../cloudfunctions/commerce/consent-version');

// These tests execute the cloud function with an in-memory database and payment
// adapter. They never call WeChat, use merchant credentials, or create real orders.
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const fixedNow = Date.now();
const receipt = () => ({ privacyVersion: consent.privacyVersion, termsVersion: consent.termsVersion, acceptedAt: fixedNow, scope: 'fulfillment' });
const createEvent = (token = 'payment-test-once', extra = {}) => ({ action: 'createPaymentTestOrder', token, privacyConsent: receipt(), ...extra });

function harness() {
  const collections = {
    products: new Map([['TESTPRODUCT', { _id: 'TESTPRODUCT', id: 'TESTPRODUCT', active: true, needsReview: false, skus: [{ id: 'TESTSKU', price: 1000, stock: 8 }] }]]),
    orders: new Map(),
    inventory_changes: new Map(),
    shop_settings: new Map()
  };
  const calls = { products: 0, orderWrites: 0, config: 0, create: [], query: [], close: [] };
  const env = { ADMIN_OPENIDS: 'admin,second-admin', ENABLE_CHECKOUT: 'false', ENABLE_PAYMENT_TEST: 'true' };
  let openid = 'admin', currentNow = fixedNow, paymentConfigured = true, paymentResult;
  const paymentConfig = { WX_APPID: 'wx_mock_app', WX_MCHID: 'mock_merchant', WX_PRIVATE_KEY: 'MOCK_PRIVATE_KEY_DO_NOT_RETURN', WX_API_V3_KEY: 'MOCK_API_KEY_DO_NOT_RETURN', WX_NOTIFY_URL: 'https://example.invalid/mock-payment' };
  function matches(row, filter) {
    return Object.entries(filter).every(([key, value]) => {
      if (key === '$and') return value.every(condition => matches(row, condition));
      if (key === '$or') return value.some(condition => matches(row, condition));
      const actual=key.split('.').reduce((v,k)=>v&&v[k],row);
      if(value && Object.hasOwn(value,'$ne'))return actual!==value.$ne;
      if(value && value.$regex!==undefined)return typeof actual==='string'&&new RegExp(value.$regex,value.$options||'').test(actual);
      if(value && Object.hasOwn(value,'$gte'))return actual>=value.$gte;
      if (value && value.$in) return value.$in.includes(actual);
      if (value && Object.hasOwn(value, '$lt')) return actual < value.$lt;
      return actual === value;
    });
  }
  function collection(name, source = collections) {
    if (name === 'products') calls.products++;
    const rows = source[name];
    if (!rows) throw new Error('Unknown mock collection: ' + name);
    function query(filter = {}) {
      let offset = 0, limit = 100;
      const sort = [];
      const result = {
        field(){return result;},
        async count(){return {total:[...rows.values()].filter(row=>matches(row,filter)).length}},
        where(next) { filter = { ...filter, ...next }; return result; },
        orderBy(key, direction) { sort.push([key, direction]); return result; },
        skip(value) { offset = value; return result; },
        limit(value) { limit = value; return result; },
        async get() {
          const data = [...rows.values()].filter(row => matches(row, filter));
          data.sort((a, b) => {
            for (const [key, direction] of sort) {
              const compared = a[key] > b[key] ? 1 : a[key] < b[key] ? -1 : 0;
              if (compared) return direction === 'desc' ? -compared : compared;
            }
            return 0;
          });
          return { data: clone(data.slice(offset, offset + limit)) };
        }
      };
      return result;
    }
    return {
      ...query(),
      where: filter => query(filter),
      doc(id) {
        return {
          async get() {
            if (!rows.has(id)) throw new Error('document not exist');
            return { data: clone(rows.get(id)) };
          },
          async set({ data }) {
            if (name === 'orders') calls.orderWrites++;
            rows.set(id, { ...clone(data), _id: id });
          },
          async update({ data }) {
            if (!rows.has(id)) throw new Error('document not exist');
            if (name === 'orders') calls.orderWrites++;
            rows.set(id, { ...rows.get(id), ...clone(data) });
          }
        };
      }
    };
  }
  const db = {
    RegExp:value=>({$regex:value.regexp,$options:value.options}),
    command: { neq:value=>({$ne:value}),gte:value=>({$gte:value}), in: values => ({ $in: values }), lt: value => ({ $lt: value }), and: values => ({ $and: values }), or: values => ({ $or: values }) },
    collection,
    async runTransaction(callback) {
      const source = Object.fromEntries(Object.entries(collections).map(([name, values]) => [name, new Map([...values].map(([id, value]) => [id, clone(value)]))]));
      const result = await callback({ collection: name => collection(name, source) });
      for (const name of Object.keys(collections)) collections[name] = source[name];
      return result;
    }
  };
  const files=new Map();
  const cloud = { async uploadFile({cloudPath,fileContent}){const fileID='cloud://mock-env.bucket/'+cloudPath;files.set(fileID,fileContent);return {fileID}},async downloadFile({fileID}){if(!files.has(fileID))throw new Error('file not found');return {fileContent:files.get(fileID)}},async getTempFileURL({fileList}){return {fileList:fileList.map(fileID=>({fileID,tempFileURL:'https://images.invalid/'+encodeURIComponent(fileID)}))}}, DYNAMIC_CURRENT_ENV: 'mock-env', init() {}, database: () => db, getWXContext: () => ({ OPENID: openid }) };
  const payment = {
    config() { calls.config++; if (!paymentConfigured) throw new Error('正式微信支付尚未配置，暂不可下单'); return { ...paymentConfig }; },
    async create(order) { calls.create.push(clone(order)); return { timeStamp: '1', nonceStr: 'mock-nonce', package: 'prepay_id=mock-prepay', signType: 'RSA', paySign: 'mock-signature' }; },
    async query(id) { calls.query.push(id); return clone(paymentResult); },
    async close(id) { calls.close.push(id); },
    decode() { return clone(paymentResult); }
  };
  class MockDate extends Date { static now() { return currentNow; } }
  const sandbox = {
    exports: {}, process: { env }, Date: MockDate, Buffer,
    console: { error() {}, log() {} },
    require(name) {
      if (name === 'wx-server-sdk') return cloud;
      if (name === './pay') return payment;
      return name.startsWith('./') ? require(path.resolve(__dirname, '../../cloudfunctions/commerce', name)) : require(name);
    }
  };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../cloudfunctions/commerce/index.js'), 'utf8'), sandbox);
  return {
    main: sandbox.exports.main, collections, calls, env, db, cloud, files,
    as(value) { openid = value; },
    advance(milliseconds) { currentNow += milliseconds; },
    configured(value) { paymentConfigured = value; },
    response(value) { paymentResult = clone(value); },
    success(order, extra = {}) { return { appid: paymentConfig.WX_APPID, mchid: paymentConfig.WX_MCHID, out_trade_no: order.id, trade_state: 'SUCCESS', amount: { total: order.total, currency: 'CNY' }, payer: { openid: order._openid }, transaction_id: 'mock-transaction', ...extra }; }
  };
}

module.exports={harness,receipt,createEvent,fixedNow};
