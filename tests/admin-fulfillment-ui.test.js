const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const clone = value => JSON.parse(JSON.stringify(value));
const event = (id, action) => ({ currentTarget: { dataset: { id, ...(action ? { action } : {}) } } });
const field = (name, value) => ({ currentTarget: { dataset: { field: name } }, detail: { value } });
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const fixtureOrders = () => [
  { id: 'fixture_delivery_a', status: 'paid', deliveryMode: 'delivery', total: 100, createdAt: 1, lines: [] },
  { id: 'fixture_delivery_b', status: 'paid', deliveryMode: 'delivery', total: 100, createdAt: 1, lines: [] },
  { id: 'fixture_pickup_a', status: 'ready_pickup', deliveryMode: 'pickup', total: 100, createdAt: 1, lines: [] },
  { id: 'fixture_pending_a', status: 'pending', deliveryMode: 'delivery', total: 100, createdAt: 1, lines: [] },
  { id: 'fixture_test_a', kind: 'payment_test', status: 'paid', total: 1, createdAt: 1, lines: [] }
];
function harness(overrides = {}) {
  const calls = { actions: [], pages: [], errors: [], navigation: [] };
  const store = {
    config: { mode: 'cloud' }, ensureAdmin: async () => {},
    adminOrderPage: async options => { calls.pages.push(clone(options)); return { orders: fixtureOrders(), hasMore: false, nextOffset: 20, nextCursor: null }; },
    merchantOverview: async () => ({ paidCents: 0, refundedCents: 0 }),
    cloud: async action => action === 'shippingCarriers' ? [{ id: 'SF', name: '测试快递' }] : { paymentConfigured: true },
    orderSummary: value => value, orderStatusName: value => value.status,
    money: value => (value / 100).toFixed(2),
    action: async (id, type, data) => { calls.actions.push({ id, type, data: clone(data || {}) }); return {}; },
    err: error => calls.errors.push(error.message), ...overrides
  };
  const wx = { navigateTo: options => calls.navigation.push(options.url), showToast() {}, stopPullDownRefresh() {} };
  const uiModule = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../miniprogram/utils/ui.js'), 'utf8'), { module: uiModule, exports: uiModule.exports, wx, setTimeout, clearTimeout });
  let page;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../miniprogram/pages/admin/index.js'), 'utf8'), {
    require: name => name.endsWith('/ui') ? uiModule.exports : store,
    Page: value => { page = value; }, wx, setTimeout, clearTimeout
  });
  page.data = clone(page.data); page.setData = data => Object.assign(page.data, clone(data));
  return { page, store, calls };
}

test('fulfillment editor opens only for a deliverable order and changing orders clears the previous tracking input', async () => {
  const { page } = harness(); await page.onShow();
  for (const id of ['fixture_pending_a', 'fixture_test_a', 'fixture_missing']) {
    page.beginFulfillment(event(id)); assert.ok(!page.data.fulfillmentId);
  }
  page.beginFulfillment(event('fixture_delivery_a')); assert.equal(page.data.fulfillmentId, 'fixture_delivery_a');
  page.field(field('tracking', 'TRACK12345')); assert.equal(page.data.tracking, 'TRACK12345');
  page.beginFulfillment(event('fixture_delivery_b')); assert.equal(page.data.fulfillmentId, 'fixture_delivery_b'); assert.equal(page.data.tracking, '');
  page.beginFulfillment(event('fixture_pickup_a')); assert.equal(page.data.fulfillmentId, 'fixture_pickup_a');
  page.field(field('pickupCode', '123456')); assert.equal(page.data.pickupCode, '123456');
});

test('fulfillment inputs cannot be filled without a selected order and cannot change while saving', async () => {
  const { page } = harness(); await page.onShow();
  page.field(field('tracking', 'WRONG12345')); page.carrierChange({ detail: { value: '0' } });
  assert.equal(page.data.tracking, ''); assert.equal(page.data.carrierCode, '');
  page.beginFulfillment(event('fixture_delivery_a')); page.field(field('tracking', 'TRACK12345')); page.carrierChange({ detail: { value: '0' } });
  assert.equal(page.data.carrierCode, 'SF'); page.setData({ busy: true });
  page.field(field('tracking', 'CHANGED12345')); page.carrierChange({ detail: { value: '-1' } }); page.beginFulfillment(event('fixture_delivery_b'));
  assert.equal(page.data.tracking, 'TRACK12345'); assert.equal(page.data.carrierCode, 'SF'); assert.equal(page.data.fulfillmentId, 'fixture_delivery_a');
});

test('shipping and pickup completion require the editor for that exact order', async () => {
  const { page, calls } = harness(); await page.onShow();
  await page.ship(event('fixture_delivery_a')); await page.pickup(event('fixture_pickup_a', 'completePickup')); assert.equal(calls.actions.length, 0);
  page.beginFulfillment(event('fixture_delivery_a')); page.field(field('tracking', 'TRACK12345')); page.carrierChange({ detail: { value: '0' } });
  await page.ship(event('fixture_delivery_b')); await page.pickup(event('fixture_pickup_a', 'completePickup')); assert.equal(calls.actions.length, 0);
  await page.ship(event('fixture_delivery_a')); assert.equal(calls.actions.length, 1); assert.equal(calls.actions[0].id, 'fixture_delivery_a');
  page.beginFulfillment(event('fixture_pickup_a')); page.field(field('pickupCode', '123456'));
  await page.pickup(event('fixture_pickup_a', 'completePickup')); assert.equal(calls.actions.length, 2); assert.deepEqual(calls.actions[1], { id: 'fixture_pickup_a', type: 'completePickup', data: { pickupCode: '123456' } });
});

test('shipping freezes the chosen order and form before authorization, while repeated actions and filter edits are blocked', async () => {
  const { page, store, calls } = harness(); await page.onShow();
  page.beginFulfillment(event('fixture_delivery_a')); page.field(field('tracking', 'TRACK12345')); page.carrierChange({ detail: { value: '0' } });
  const auth = deferred(); let attempts = 0; store.ensureAdmin = () => ++attempts === 1 ? auth.promise : Promise.resolve();
  const saveEvent = event('fixture_delivery_a'), saving = page.ship(saveEvent);
  assert.equal(page.data.busy, true); saveEvent.currentTarget.dataset.id = 'fixture_delivery_b';
  page.field(field('tracking', 'CHANGED12345')); page.searchInput({ detail: { value: '13900000000' } });
  await page.search(); await page.filter(event('pending')); await page.deliveryFilter(event('pickup')); await page.summaryFilter({ currentTarget: { dataset: { status: 'paid', mode: 'pickup' } } });
  await page.ship(event('fixture_delivery_b')); page.beginFulfillment(event('fixture_delivery_b'));
  assert.equal(page.data.status, 'all'); assert.equal(page.data.deliveryMode, 'all'); assert.equal(page.data.keyword, ''); assert.equal(page.data.tracking, 'TRACK12345');
  auth.resolve(); await saving;
  assert.equal(calls.actions.length, 1); assert.deepEqual(calls.actions[0], { id: 'fixture_delivery_a', type: 'ship', data: { carrier: '测试快递', carrierCode: 'SF', tracking: 'TRACK12345' } });
  assert.equal(page.data.busy, false);
});

test('pickup completion freezes the entered code and never adopts a changed event during authorization', async () => {
  const { page, store, calls } = harness(); await page.onShow();
  page.beginFulfillment(event('fixture_pickup_a')); page.field(field('pickupCode', '123456'));
  const auth = deferred(); let attempts = 0; store.ensureAdmin = () => ++attempts === 1 ? auth.promise : Promise.resolve();
  const saveEvent = event('fixture_pickup_a', 'completePickup'), saving = page.pickup(saveEvent);
  saveEvent.currentTarget.dataset.id = 'fixture_delivery_b'; saveEvent.currentTarget.dataset.action = 'preparePickup'; page.field(field('pickupCode', '654321'));
  auth.resolve(); await saving;
  assert.deepEqual(calls.actions, [{ id: 'fixture_pickup_a', type: 'completePickup', data: { pickupCode: '123456' } }]);
});

test('leaving while authorization is pending prevents a new fulfillment mutation', async () => {
  for (const leave of ['onHide', 'onUnload']) {
    const { page, store, calls } = harness(); await page.onShow();
    page.beginFulfillment(event('fixture_delivery_a')); page.field(field('tracking', 'TRACK12345')); page.carrierChange({ detail: { value: '0' } });
    const auth = deferred(); store.ensureAdmin = () => auth.promise;
    const saving = page.ship(event('fixture_delivery_a')); page[leave](); auth.resolve(); await saving;
    assert.equal(calls.actions.length, 0, leave + ' must prevent dispatch after authorization');
    assert.equal(page.data.authorized, false);
  }
});

test('overview shortcuts clear a previous phone search before loading the selected queue', async () => {
  const { page, calls } = harness(); await page.onShow();
  page.setData({ keyword: '13900000000', searchText: '13900000000' });
  await page.summaryFilter({ currentTarget: { dataset: { status: 'paid', mode: 'delivery' } } });
  assert.equal(page.data.keyword, ''); assert.equal(page.data.searchText, '');
  assert.equal(calls.pages.at(-1).keyword, ''); assert.equal(calls.pages.at(-1).status, 'paid'); assert.equal(calls.pages.at(-1).deliveryMode, 'delivery');
});

test('initial loading distinguishes authorization from the order query and stops the checking indicator on failure', async () => {
  const auth = deferred(), orders = deferred(), started = deferred();
  const { page } = harness({ ensureAdmin: () => auth.promise, adminOrderPage: () => { started.resolve(); return orders.promise; } });
  const showing = page.onShow(); assert.equal(page.data.checking, true); assert.equal(page.data.authorized, false);
  auth.resolve(); await started.promise; assert.equal(page.data.checking, false); assert.equal(page.data.loading, true);
  orders.resolve({ orders: [], hasMore: false, nextOffset: 20 }); await showing; assert.equal(page.data.loading, false);
  const failed = harness({ ensureAdmin: async () => { throw new Error('暂时无法核对身份'); } }); await failed.page.onShow();
  assert.equal(failed.page.data.checking, false); assert.equal(failed.page.data.authorized, false); assert.match(failed.page.data.error, /核对身份/);
});

test('a hidden administrator page cannot regain authorization or display orders from a late response', async () => {
  const auth = deferred(); const first = harness({ ensureAdmin: () => auth.promise });
  const authorizing = first.page.onShow(); first.page.onHide(); auth.resolve(); await authorizing;
  assert.equal(first.page.data.authorized, false); assert.equal(first.calls.pages.length, 0); assert.deepEqual(first.page.data.orders, []);
  const orders = deferred(), started = deferred(); const second = harness({ adminOrderPage: () => { started.resolve(); return orders.promise; } });
  const showing = second.page.onShow(); await started.promise; second.page.onHide(); orders.resolve({ orders: fixtureOrders(), hasMore: false, nextOffset: 20 }); await showing;
  assert.equal(second.page.data.authorized, false); assert.deepEqual(second.page.data.orders, []);
});

test('returning during an in-flight fulfillment operation refreshes the visible page once after it settles', async () => {
  for (const phase of ['authorization', 'mutation']) {
    const { page, store, calls } = harness(); await page.onShow();
    page.beginFulfillment(event('fixture_delivery_a')); page.field(field('tracking', 'TRACK12345')); page.carrierChange({ detail: { value: '0' } });
    const pending = deferred(), started = deferred();
    if (phase === 'authorization') {
      let authorizations = 0;
      store.ensureAdmin = () => ++authorizations === 1 ? pending.promise : Promise.resolve();
    } else {
      store.action = async (id, type, data) => { calls.actions.push({ id, type, data: clone(data) }); started.resolve(); return pending.promise; };
    }
    const saving = page.ship(event('fixture_delivery_a'));
    if (phase === 'mutation') await started.promise;
    page.onHide(); await page.onShow(); await page.onShow();
    assert.equal(page.data.authorized, false); assert.equal(page.data.busy, true); assert.equal(calls.pages.length, 1);
    pending.resolve({}); await saving;
    assert.equal(page.data.busy, false); assert.equal(page.data.authorized, true); assert.equal(page.data.checking, false);
    assert.equal(calls.pages.length, 2, phase + ' should trigger one deferred reload');
    assert.equal(calls.actions.length, phase === 'mutation' ? 1 : 0);
    assert.equal(page.data.orders.length, fixtureOrders().length);
  }
});
