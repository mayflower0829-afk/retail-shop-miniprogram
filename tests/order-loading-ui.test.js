const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const clone = value => JSON.parse(JSON.stringify(value));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function order(status) { return { id: 'fixture_order', status, total: 100, createdAt: 1, lines: [], canPay: status === 'pending', canCancel: status === 'pending', canReceive: status === 'shipped' }; }
function harness(overrides = {}) {
  const calls = { pays: 0, actions: [], syncs: 0, dialogs: 0, errors: [] };
  const store = { config: { mode: 'cloud' }, order: async () => order('pending'), money: n => (n / 100).toFixed(2), lineTitle: l => l.name,
    orderStatusName: o => o.status, pay: async () => { calls.pays++; }, action: async (id, type) => { calls.actions.push(type); },
    cloud: async () => { calls.syncs++; }, err: e => calls.errors.push(e.message), ...overrides };
  const wx = { showModal: options => { calls.dialogs++; options.success({ confirm: true }); }, navigateTo() {} };
  let page;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../miniprogram/pages/order/index.js'), 'utf8'), { require: () => store, Page: value => { page = value; }, wx });
  page.data = clone(page.data); page.setData = data => Object.assign(page.data, clone(data)); page.onLoad({ id: 'fixture_order' });
  return { page, store, calls };
}
const event = action => ({ currentTarget: { dataset: { action } } });

test('first order read exposes loading until an actionable order has actually arrived', async () => {
  const response = deferred(), { page } = harness({ order: () => response.promise });
  const reading = page.onShow();
  assert.equal(page.data.loading, true); assert.equal(page.data.o, null); assert.equal(page.data.canPay, false); assert.equal(page.data.showPay, false);
  response.resolve(order('pending')); await reading;
  assert.equal(page.data.loading, false); assert.equal(page.data.o.status, 'pending'); assert.equal(page.data.canPay, true); assert.equal(page.data.showPay, true); assert.equal(page.data.showCancel, true);
});

test('refresh keeps the previous action layout but blocks payment, cancellation and sync until the latest snapshot arrives', async () => {
  const { page, store, calls } = harness(); await page.onShow();
  const response = deferred(); store.order = () => response.promise; const refreshing = page.reload();
  assert.equal(page.data.loading, true); assert.equal(page.data.o.status, 'pending');
  assert.equal(page.data.showPay, true); assert.equal(page.data.showCancel, true); assert.equal(page.data.canPay, false); assert.equal(page.data.canCancel, false);
  await page.pay(); await page.operate(event('cancel')); await page.sync();
  assert.equal(calls.pays, 0); assert.equal(calls.dialogs, 0); assert.equal(calls.syncs, 0); assert.deepEqual(calls.actions, []);
  response.resolve(order('paid')); await refreshing;
  assert.equal(page.data.loading, false); assert.equal(page.data.showPay, false); assert.equal(page.data.showCancel, false); assert.equal(page.data.o.status, 'paid');
});

test('an older success or failure cannot stop the loading indicator for a newer order read', async () => {
  for (const fail of [false, true]) {
    const { page, store } = harness(); await page.onShow();
    const old = deferred(), fresh = deferred(); let reads = 0; store.order = () => ++reads === 1 ? old.promise : fresh.promise;
    const older = page.reload(), newer = page.reload();
    if (fail) old.reject(new Error('obsolete failure')); else old.resolve(order('shipped'));
    await older; assert.equal(page.data.loading, true); assert.equal(page.data.o.status, 'pending'); assert.equal(page.data.error, '');
    fresh.resolve(order('paid')); await newer; assert.equal(page.data.loading, false); assert.equal(page.data.o.status, 'paid');
  }
});

test('a current load failure removes stale actions and a successful retry restores only the new permissions', async () => {
  const { page, store } = harness(); await page.onShow();
  store.order = async () => { throw new Error('暂时无法加载订单'); }; await page.reload();
  assert.equal(page.data.loading, false); assert.equal(page.data.o, null); assert.equal(page.data.showPay, false); assert.equal(page.data.showCancel, false); assert.equal(page.data.showReceive, false); assert.match(page.data.error, /无法加载/);
  store.order = async () => order('shipped'); await page.reload();
  assert.equal(page.data.loading, false); assert.equal(page.data.showPay, false); assert.equal(page.data.showReceive, true); assert.equal(page.data.canReceive, true); assert.equal(page.data.error, '');
});

test('leaving the order page prevents a late read from restoring the skeleton or action controls', async () => {
  const response = deferred(), { page } = harness({ order: () => response.promise });
  const reading = page.onShow(); page.onUnload(); response.resolve(order('pending')); await reading;
  assert.equal(page.data.loading, false); assert.equal(page.data.o, null); assert.equal(page.data.showPay, false); assert.equal(page.data.canPay, false);
});

test('native payment return can reload while payment stays busy without unlocking a second action', async () => {
  const payment = deferred(), { page, store, calls } = harness(); await page.onShow();
  store.pay = async () => { calls.pays++; return payment.promise; };
  const paying = page.pay(); assert.equal(page.data.busy, true);
  const returnedRead = deferred(), finalRead = deferred(), finalStarted = deferred(); let reads = 0;
  store.order = () => { if (++reads === 1) return returnedRead.promise; finalStarted.resolve(); return finalRead.promise; };
  const showing = page.onShow(); assert.equal(page.data.loading, true);
  returnedRead.resolve(order('paid')); await showing;
  assert.equal(page.data.loading, false); assert.equal(page.data.busy, true); await page.sync(); assert.equal(calls.syncs, 0);
  payment.resolve(); await finalStarted.promise; assert.equal(page.data.loading, true); assert.equal(page.data.busy, true);
  finalRead.resolve(order('paid')); await paying;
  assert.equal(page.data.loading, false); assert.equal(page.data.busy, false); assert.equal(calls.pays, 1); assert.equal(page.data.showPay, false);
});

test('returning from native receipt confirmation keeps the previous layout disabled while its existing reconciliation runs', async () => {
  const receipt = deferred(), { page, store, calls } = harness({ order: async () => order('shipped') }); await page.onShow();
  store.action = async (id, type) => { calls.actions.push(type); return receipt.promise; }; store.order = async () => order('completed');
  page._awaitingWechatReceipt = true; const showing = page.onShow();
  assert.equal(page.data.loading, true); assert.equal(page.data.showReceive, true);
  await page.operate(event('receive')); await page.sync(); assert.equal(calls.dialogs, 0); assert.equal(calls.syncs, 0); assert.deepEqual(calls.actions, ['receive']);
  receipt.resolve(); await showing;
  assert.equal(page.data.loading, false); assert.equal(page.data.showReceive, false); assert.equal(page.data.o.status, 'completed');
});
