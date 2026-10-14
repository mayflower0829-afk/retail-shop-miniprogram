const test=require('node:test'),assert=require('node:assert/strict');
const {harness,receipt,createEvent,fixedNow}=require('./helpers/commerce-harness');
const consent=require('../cloudfunctions/commerce/consent-version');
const clone=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
test('one-cent test creation requires both a shop administrator and the explicit test switch', async () => {
  const h = harness();
  h.as('visitor');
  assert.equal((await h.main(createEvent())).ok, false);
  assert.equal(h.calls.config, 0);
  h.as('admin');
  for (const value of [undefined, '', 'false', 'TRUE']) {
    h.env.ENABLE_PAYMENT_TEST = value;
    assert.equal((await h.main(createEvent())).ok, false);
  }
  assert.equal(h.collections.orders.size, 0);
  assert.equal(h.calls.products, 0);
  h.env.ENABLE_PAYMENT_TEST = 'true';
  assert.equal(h.env.ENABLE_CHECKOUT, 'false');
  assert.equal((await h.main(createEvent())).ok, true);
  assert.equal(h.collections.orders.size, 1);
});

test('test creation rejects missing or stale consent before writing the order', async () => {
  const h = harness();
  for (const privacyConsent of [undefined, null, { ...receipt(), privacyVersion: 'old' }, { ...receipt(), scope: 'all' }, { ...receipt(), acceptedAt: fixedNow + 120000 }]) {
    assert.equal((await h.main(createEvent('consent-test-token', { privacyConsent }))).ok, false);
  }
  assert.equal(h.collections.orders.size, 0);
  assert.equal(h.calls.products, 0);
});

test('invalid request tokens never create a test order or touch product inventory', async () => {
  const h = harness();
  for (const token of [undefined, null, '', 'short', 12345678, [], 'x'.repeat(81), 'invalid/token', 'token with spaces']) {
    assert.equal((await h.main(createEvent(token, { token }))).ok, false);
  }
  assert.equal(h.collections.orders.size, 0);
  assert.equal(h.calls.products, 0);
});

test('test orders have a server-fixed one-cent total and ignore injected commerce fields', async () => {
  const h = harness(), before = clone([...h.collections.products]);
  const result = await h.main(createEvent('fixed-test-total', {
    total: 99999, price: 0, shippingFee: 500, discountAmount: 1,
    kind: 'normal', demo: true, status: 'paid', _openid: 'visitor',
    items: [{ skuId: 'TESTSKU', qty: 999 }], lines: [{ productId: 'TESTPRODUCT', qty: 999 }],
    deliveryMode: 'delivery', address: { phone: '13900000000' }, pickupContact: { phone: '13900000000' },
    createdAt: 1, expiresAt: 1
  }));
  assert.equal(result.ok, true);
  const order = result.data;
  assert.equal(order.total, 1);
  assert.equal(order.shippingFee, 0);
  assert.equal(order.discountAmount, 0);
  assert.equal(order.kind, 'payment_test');
  assert.equal(order.demo, false);
  assert.equal(order.status, 'pending');
  assert.equal(order._openid, 'admin');
  assert.equal(order.deliveryMode, 'none');
  assert.equal(order.address, null);
  assert.equal(order.pickupContact, null);
  assert.deepEqual(clone(order.lines), []);
  assert.equal(order.createdAt, fixedNow);
  assert.equal(order.expiresAt - order.createdAt, 15 * 60 * 1000);
  assert.equal(order.privacyConsent.privacyVersion, consent.privacyVersion);
  assert.equal(h.calls.products, 0);
  assert.deepEqual(clone([...h.collections.products]), before);
  assert.equal(h.collections.inventory_changes.size, 0);
});

test('administrator-and-token retries return the same order without extending payment time', async () => {
  const h = harness();
  const first = await h.main(createEvent('idempotent-test-token'));
  assert.equal(first.ok, true);
  h.advance(60000);
  const retry = await h.main(createEvent('idempotent-test-token', { total: 800 }));
  assert.equal(retry.ok, true);
  assert.equal(retry.data.id, first.data.id);
  assert.equal(retry.data.createdAt, first.data.createdAt);
  assert.equal(retry.data.expiresAt, first.data.expiresAt);
  assert.equal(h.collections.orders.size, 1);
  assert.equal(h.calls.orderWrites, 1);
  h.as('second-admin');
  const other = await h.main(createEvent('idempotent-test-token'));
  assert.equal(other.ok, true);
  assert.notEqual(other.data.id, first.data.id);
  assert.equal(h.collections.orders.size, 2);
  assert.equal(h.calls.products, 0);
});

test('unconfigured payment rejects one-cent creation without leaving an unpaid order', async () => {
  const h = harness();
  h.configured(false);
  assert.equal((await h.main(createEvent())).ok, false);
  assert.equal(h.collections.orders.size, 0);
  assert.equal(h.calls.products, 0);
});

test('real pay actions require the order owner, including when the caller is another administrator', async () => {
  const h = harness(), created = await h.main(createEvent());
  assert.equal(created.ok, true);
  const order = created.data;
  h.as('visitor');
  assert.equal((await h.main({ action: 'pay', id: order.id })).ok, false);
  h.as('second-admin');
  assert.equal((await h.main({ action: 'pay', id: order.id })).ok, false);
  assert.equal(h.calls.create.length, 0);
  h.as('admin');
  assert.equal((await h.main({ action: 'pay', id: order.id })).ok, true);
  assert.equal(h.calls.create.length, 1);
  assert.equal(h.calls.create[0].total, 1);
  assert.equal(h.collections.orders.get(order.id).status, 'pending');
  assert.equal(h.collections.orders.get(order.id).lock, '');
  const normal = { _id: 'NORMAL001', id: 'NORMAL001', _openid: 'ordinary-owner', status: 'pending', total: 1000, expiresAt: fixedNow + 900000, lock: '', lines: [] };
  h.collections.orders.set(normal.id, normal);
  assert.equal((await h.main({ action: 'pay', id: normal.id })).ok, false);
  h.as('ordinary-owner');
  assert.equal((await h.main({ action: 'pay', id: normal.id })).ok, false);
  h.env.ENABLE_CHECKOUT = 'true';
  assert.equal((await h.main({ action: 'pay', id: normal.id })).ok, true);
});

test('payment callbacks reject the wrong amount, currency, merchant, app or payer', async () => {
  for (const patch of [
    { amount: { total: 2, currency: 'CNY' } },
    { amount: { total: 1, currency: 'USD' } },
    { mchid: 'other-merchant' }, { appid: 'wx_other_app' }, { payer: { openid: 'visitor' } }
  ]) {
    const h = harness(), order = (await h.main(createEvent())).data;
    h.response(h.success(order, patch));
    assert.equal((await h.main({ httpMethod: 'POST', body: 'mock-verified-body' })).statusCode, 400);
    assert.equal(h.collections.orders.get(order.id).status, 'pending');
    assert.equal(h.collections.orders.get(order.id).transactionId, undefined);
  }
});

test('expired payment tests refuse another payment and cancel without changing product stock', async () => {
  const h = harness(), order = (await h.main(createEvent())).data;
  h.advance(15 * 60 * 1000 + 1);
  assert.equal((await h.main({ action: 'pay', id: order.id })).ok, false);
  assert.equal(h.calls.create.length, 0);
  h.response({ trade_state: 'NOTPAY' });
  const cancelled = await h.main({ action: 'cancel', id: order.id });
  assert.equal(cancelled.ok, true);
  assert.equal(cancelled.data.status, 'cancelled');
  assert.deepEqual(h.calls.close, [order.id]);
  assert.equal(h.calls.products, 0);
  assert.equal(h.collections.products.get('TESTPRODUCT').skus[0].stock, 8);
  assert.equal(h.collections.inventory_changes.size, 0);
});

test('valid callbacks mark paid once and repeated callbacks cannot duplicate the state change', async () => {
  const h = harness(), order = (await h.main(createEvent())).data;
  h.response(h.success(order));
  assert.equal((await h.main({ httpMethod: 'POST', body: 'mock-verified-body' })).statusCode, 204);
  const paid = clone(h.collections.orders.get(order.id)), writes = h.calls.orderWrites;
  assert.equal(paid.status, 'paid');
  assert.equal(paid.transactionId, 'mock-transaction');
  h.advance(10000);
  assert.equal((await h.main({ httpMethod: 'POST', body: 'mock-verified-body' })).statusCode, 204);
  assert.deepEqual(clone(h.collections.orders.get(order.id)), paid);
  assert.equal(h.calls.orderWrites, writes);
  assert.equal(h.calls.products, 0);
});

test('payment synchronization uses the same verified payment amount and payer checks', async () => {
  const h = harness(), order = (await h.main(createEvent())).data;
  h.response(h.success(order, { amount: { total: 2, currency: 'CNY' } }));
  assert.equal((await h.main({ action: 'syncPayment', id: order.id })).ok, false);
  assert.equal(h.collections.orders.get(order.id).status, 'pending');
  h.response(h.success(order));
  assert.equal((await h.main({ action: 'syncPayment', id: order.id })).data.status, 'paid');
  assert.deepEqual(h.calls.query, [order.id, order.id]);
});

test('payment tests cannot create shipping, pickup, receipt or fake refund states', async () => {
  const h = harness(), order = (await h.main(createEvent())).data;
  const paid = { ...order, status: 'paid', lock: '' };
  const cases = [
    { action: 'ship', status: 'paid', deliveryMode: 'delivery', carrier: '测试快递', tracking: 'MOCK12345' },
    { action: 'preparePickup', status: 'paid', deliveryMode: 'pickup' },
    { action: 'completePickup', status: 'ready_pickup', deliveryMode: 'pickup', pickupCode: '123456' },
    { action: 'receive', status: 'shipped', deliveryMode: 'delivery' },
    { action: 'refund', status: 'paid', reason: '测试订单不可假退款' }
  ];
  for (const input of cases) {
    const current = { ...paid, status: input.status, deliveryMode: input.deliveryMode || 'none', pickupCode: '123456' };
    h.collections.orders.set(order.id, clone(current));
    assert.equal((await h.main({ ...input, id: order.id })).ok, false, input.action);
    assert.deepEqual(clone(h.collections.orders.get(order.id)), current, input.action);
  }
  assert.equal(h.calls.products, 0);
});

test('runtime diagnostics expose only readiness flags and require administrator permission', async () => {
  const h = harness();
  h.as('visitor');
  assert.equal((await h.main({ action: 'runtime' })).ok, false);
  assert.deepEqual(clone((await h.main({ action: 'whoami' })).data), { openid: 'visitor', isAdmin: false });
  h.as('admin');
  const response = await h.main({ action: 'runtime' });
  assert.equal(response.ok, true);
  assert.deepEqual(Object.keys(response.data).sort(), ['adminConfigured', 'automaticExpiryConfigured', 'automaticExpiryEnabled', 'checkoutEnabled', 'orderShippingEnabled', 'paymentConfigured', 'paymentTestEnabled', 'version']);
  assert.equal(typeof response.data.version, 'string');
  assert.ok(response.data.version.length > 0);
  assert.equal(response.data.checkoutEnabled, false);
  assert.equal(response.data.paymentTestEnabled, true);
  assert.equal(response.data.paymentConfigured, true);
  assert.equal(response.data.adminConfigured, true);
  assert.ok(!JSON.stringify(response).includes('MOCK_PRIVATE_KEY'));
  assert.ok(!JSON.stringify(response).includes('MOCK_API_KEY'));
  h.configured(false);
  assert.equal((await h.main({ action: 'runtime' })).data.paymentConfigured, false);
});

test('administrator pagination is permission guarded and returns every order beyond the first hundred', async () => {
  const h = harness();
  for (let i = 0; i < 121; i++) {
    const id = 'PAGED' + String(i).padStart(4, '0');
    h.collections.orders.set(id, { _id: id, id, _openid: 'ordinary-owner', status: i % 2 ? 'paid' : 'pending', createdAt: i, total: 1000, lines: [] });
  }
  h.as('ordinary-owner');
  assert.equal((await h.main({ action: 'adminOrderPage', offset: 0 })).ok, false);
  h.as('admin');
  let offset = 0, all = [];
  for (let pageCount = 0; pageCount < 10; pageCount++) {
    const response = await h.main({ action: 'adminOrderPage', offset, limit: 20, status: 'all' });
    assert.equal(response.ok, true);
    all.push(...response.data.orders);
    if (!response.data.hasMore) break;
    assert.ok(response.data.nextOffset > offset);
    offset = response.data.nextOffset;
  }
  assert.equal(all.length, 121);
  assert.equal(new Set(all.map(order => order.id)).size, 121);
  assert.equal(all[0].createdAt, 120);
  const filtered = await h.main({ action: 'adminOrderPage', offset: 20, limit: 20, status: 'paid' });
  assert.equal(filtered.ok, true);
  assert.equal(filtered.data.orders.length, 20);
  assert.ok(filtered.data.orders.every(order => order.status === 'paid'));
  for (const params of [{ offset: -1 }, { limit: 0 }, { limit: 51 }, { offset: 1.5 }, { status: 'invented-status' }]) {
    assert.equal((await h.main({ action: 'adminOrderPage', ...params })).ok, false);
  }
});

test('administrator cursors do not skip an awaiting-shipment order when an earlier row changes status', async () => {
  const h = harness(), ids = ['ORDER-A', 'ORDER-B', 'ORDER-C', 'ORDER-D'];
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    h.collections.orders.set(id, { _id: id, id, _openid: 'ordinary-owner', status: 'paid', createdAt: 4 - i, total: 1000, lines: [] });
  }
  const first = await h.main({ action: 'adminOrderPage', status: 'paid', limit: 2 });
  assert.equal(first.ok, true);
  assert.deepEqual(clone(first.data.orders.map(order => order.id)), ['ORDER-A', 'ORDER-B']);
  assert.deepEqual(clone(first.data.nextCursor), { createdAt: 3, id: 'ORDER-B' });
  assert.equal(first.data.hasMore, true);
  h.collections.orders.set('ORDER-A', { ...h.collections.orders.get('ORDER-A'), status: 'shipped' });
  const next = await h.main({ action: 'adminOrderPage', status: 'paid', limit: 2, offset: first.data.nextOffset, cursor: first.data.nextCursor });
  assert.equal(next.ok, true);
  assert.deepEqual(clone(next.data.orders.map(order => order.id)), ['ORDER-C', 'ORDER-D']);
  assert.equal(next.data.hasMore, false);
  assert.deepEqual(clone(next.data.nextCursor), { createdAt: 1, id: 'ORDER-D' });
});

test('administrator cursors use descending document IDs to paginate equal timestamps without repeats or omissions', async () => {
  const h = harness(), ids = Array.from({ length: 5 }, (_, i) => 'TIED-' + String(i).padStart(3, '0'));
  for (const id of ids) h.collections.orders.set(id, { _id: id, id, _openid: 'ordinary-owner', status: 'paid', createdAt: 42, total: 1000, lines: [] });
  const first = await h.main({ action: 'adminOrderPage', status: 'paid', limit: 2 });
  assert.equal(first.ok, true);
  assert.deepEqual(clone(first.data.orders.map(order => order.id)), ['TIED-004', 'TIED-003']);
  assert.deepEqual(clone(first.data.nextCursor), { createdAt: 42, id: 'TIED-003' });
  let cursor = first.data.nextCursor, all = first.data.orders.map(order => order.id);
  // A newly inserted row sorts ahead of the cursor and must not shift later pages.
  h.collections.orders.set('TIED-005', { _id: 'TIED-005', id: 'TIED-005', _openid: 'ordinary-owner', status: 'paid', createdAt: 42, total: 1000, lines: [] });
  for (let count = 0; count < 5; count++) {
    const result = await h.main({ action: 'adminOrderPage', status: 'paid', limit: 2, cursor });
    assert.equal(result.ok, true);
    all.push(...result.data.orders.map(order => order.id));
    if (!result.data.hasMore) break;
    assert.notDeepEqual(clone(result.data.nextCursor), clone(cursor));
    cursor = result.data.nextCursor;
  }
  assert.deepEqual(clone(all), [...ids].reverse());
  assert.equal(new Set(all).size, ids.length);
});

test('administrator cursors reject malformed inputs and do not grant another user management access', async () => {
  const h = harness();
  for (const cursor of [
    '', 0, 'cursor', [], {}, { createdAt: 1 }, { id: 'ORDER-A' },
    { createdAt: -1, id: 'ORDER-A' }, { createdAt: 1.5, id: 'ORDER-A' },
    { createdAt: '1', id: 'ORDER-A' }, { createdAt: Number.MAX_SAFE_INTEGER + 1, id: 'ORDER-A' },
    { createdAt: 1, id: 'short' }, { createdAt: 1, id: 'wrong/path' }, { createdAt: 1, id: 'x'.repeat(41) }
  ]) {
    const result = await h.main({ action: 'adminOrderPage', cursor });
    assert.equal(result.ok, false);
    assert.match(result.message, /游标/);
  }
  h.as('ordinary-owner');
  const denied = await h.main({ action: 'adminOrderPage', status: 'paid', cursor: { createdAt: 1, id: 'ORDER-A' } });
  assert.equal(denied.ok, false);
  assert.match(denied.message, /管理员/);
});
