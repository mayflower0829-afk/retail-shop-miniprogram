const privacy=require('../miniprogram/utils/privacy');
const test=require('node:test'),assert=require('node:assert/strict');
const storage=new Map(),copy=v=>v===undefined?undefined:JSON.parse(JSON.stringify(v));let navigation='';
global.wx={getStorageSync:k=>copy(storage.get(k)),setStorageSync:(k,v)=>storage.set(k,copy(v)),showToast(){},navigateTo:o=>{navigation=o.url}};
const s=require('../miniprogram/utils/store'),seed=require('../miniprogram/data/products');
s.config.demoAdminEnabled=true; // Test-only shop-manager view.
function page(name){let p;global.Page=x=>p=x;const file=require.resolve('../miniprogram/pages/'+name+'/index');delete require.cache[file];require(file);p.data=copy(p.data);p.setData=function(v){Object.assign(this.data,copy(v))};return p}
test('quick add reselects an existing cart item, respects stock and never reserves goods',async()=>{
  storage.clear();privacy.acceptConsent(true);const p=(await s.catalog()).find(p=>p.id==='demo-001');p.skus[0].stock=2;
  s.saveCart([{skuId:p.skus[0].id,qty:1,selected:false}]);assert.equal(s.quickAdd(p),true);assert.deepEqual(s.cart(),[{skuId:p.skus[0].id,qty:2,selected:true}]);
  assert.throws(()=>s.quickAdd(p),/可购买数量/);assert.equal(s.cart()[0].qty,2);assert.equal((await s.catalog()).find(p=>p.id==='demo-001').stock,10);assert.equal((await s.orders()).length,0);
  assert.throws(()=>s.quickAdd({...p,skus:[{...p.skus[0],stock:0}]}),/售罄/);assert.throws(()=>s.quickAdd({...p,active:false}),/下架/);
});
test('multi-variant card asks the customer to choose; unavailable goods follow available goods even under price sort',async()=>{
  storage.clear();privacy.acceptConsent(true);const p=(await s.catalog())[0],multi={...p,id:'multi',skus:[...p.skus,{...p.skus[0],id:'other'}]};const home=page('home');home.setData({products:[multi]});home.quickAdd({currentTarget:{dataset:{id:'multi'}}});assert.match(navigation,/detail\/index\?id=multi$/);assert.deepEqual(s.cart(),[]);
  const cheap={...p,id:'cheap',stock:0,skus:[{...p.skus[0],salePrice:1}]},available={...p,id:'available',stock:1,skus:[{...p.skus[0],salePrice:500}]};assert.deepEqual(s.sortProducts([cheap,available],'asc').map(p=>p.id),['available','cheap']);assert.deepEqual(s.sortProducts([cheap,available],'desc').map(p=>p.id),['available','cheap']);
});
test('shipping progress follows only checked discounted goods and exact threshold',async()=>{
  storage.clear();privacy.acceptConsent(true);s.saveCart([{skuId:'demo-001-default',qty:1,selected:true},{skuId:'demo-003-default',qty:10,selected:false}]);const cart=page('cart');await cart.reload();assert.equal(cart.data.total,'5.00');assert.match(cart.data.shippingText,/不满邮费5元/);assert.equal(cart.data.shippingHint,'折后还差¥64.00包邮');assert.equal(cart.data.count,1);
  cart.toggle({currentTarget:{dataset:{id:'demo-003-default'}}});await cart.reload();assert.equal(cart.data.total,'80.00');assert.match(cart.data.shippingHint,/已包邮/);assert.equal(cart.data.shippingProgress,100);
  s.saveCart([{skuId:'demo-001-default',qty:1,selected:false}]);await cart.reload();assert.match(cart.data.shippingHint,/勾选商品/);assert.equal(cart.data.shippingProgress,0);
  const policy={freeShipping:6900,shippingFee:null};assert.equal(s.shippingProgress(6899,1,policy).shippingHint,'折后还差¥0.01包邮');assert.match(s.shippingProgress(6900,1,policy).shippingHint,/已包邮/);
});
test('readable titles do not change source names or erase a subsequently renamed product; empty novelty entries stay hidden',async()=>{
  storage.clear();privacy.acceptConsent(true);const home=page('home');await home.reload();assert.ok(!home.data.filters.includes('新品'));assert.ok(!home.data.filters.includes('买过'));assert.ok(home.data.filters.includes('收藏'));
  const p=home.data.products.find(p=>p.id==='demo-001');assert.ok(p.name.endsWith('9001'));assert.ok(!p.displayName.endsWith('9001'));assert.equal(seed.find(p=>p.id==='demo-001').name,p.name);
  assert.equal(s.productTitle({...p,name:'示例角色2026'}),'示例角色2026');home.search({detail:{value:'9001'}});assert.equal(home.data.visible[0].id,'demo-001');
});
test('shop cards show frozen amounts, quantities and the correct delivery contact without modifying orders',async()=>{
  storage.clear();privacy.acceptConsent(true);const raw={id:'historic-order',createdAt:1,status:'paid',total:1800,deliveryMode:'pickup',pickupContact:{name:'测试自取人',phone:'13900000000'},address:{name:'不应显示的快递联系人'},lines:[{productId:'demo-001',skuId:'demo-001-default',name:seed[0].name,qty:2,image:seed[0].image}]};
  storage.set('guzi.template.demo.v1',{products:copy(seed),orders:[raw]});const admin=page('admin');await admin.reload();const card=admin.data.orders[0];assert.equal(card.totalText,'18.00');assert.equal(card.quantity,2);assert.equal(card.contactName,'测试自取人');assert.equal(card.statusName,'待备货');assert.equal(card.preview[0].displayName,s.productTitle(seed[0]));assert.equal(admin.data.hasDeliveryToShip,false);assert.equal(admin.data.hasPickupToRedeem,false);assert.deepEqual(await s.order(raw.id),raw);
});

test('shipping copy follows the server policy and avoids stale store-specific postage',()=>{assert.equal(s.shippingDescription({...s.config,shippingFee:500}),'折后满69元包邮 · 不满邮费5元 · 自取免邮');assert.equal(s.shippingDescription({...s.config,freeShipping:7000,shippingFee:650,pickupEnabled:false}),'折后满70元包邮 · 不满邮费6.5元');assert.equal(s.shippingDescription({...s.config,shippingFee:0}),'快递免邮 · 自取免邮');assert.equal(s.shippingDescription({...s.config,shippingFee:null}),'运费以结算页为准 · 自取免邮')});
