const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const copy=v=>v===undefined?undefined:JSON.parse(JSON.stringify(v)),tick=()=>new Promise(resolve=>setImmediate(resolve));
const pending=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
const policy={promotion:{enabled:true,discountBps:5000,title:'全场五折'},freeShipping:6900,shippingFee:500,pickupEnabled:true,pickupLocation:'与店主联系确认',pickupHours:'与店主联系确认',revision:1};
const product={id:'item',name:'测试商品',displayName:'测试商品',active:true,image:'/assets/placeholder.jpg',skus:[{id:'item-sku',name:'默认款',price:2000,stock:3}]};
const address={name:'测试收货人',phone:'13900000000',region:['北京','北京','东城'],detail:'测试收货地址一号'};
function harness(overrides={}){
 let accepted=true,cart=[{skuId:'item-sku',qty:1,selected:true}],page;
 const storage=new Map([['checkout.v1',[{skuId:'item-sku',qty:1}]]]),calls={orders:[],navigation:[],errors:[],addressReads:0};
 const privacy={hasConsent:()=>accepted,assertConsent(){if(!accepted)throw new Error('请先同意隐私政策')}};
 const wx={getStorageSync:k=>copy(storage.get(k)),setStorageSync:(k,v)=>storage.set(k,copy(v)),removeStorageSync:k=>storage.delete(k),showToast(){},navigateTo:o=>calls.navigation.push(o),switchTab:o=>calls.navigation.push(o),redirectTo:o=>calls.navigation.push(o)};
 function module(file,require){const m={exports:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../miniprogram/utils',file),'utf8'),{module:m,require,wx,setTimeout,clearTimeout});return m.exports}
 const ui=module('ui.js'),consent=module('consent-page.js',()=>privacy),domain=require('../miniprogram/utils/domain');
 const service={config:{mode:'cloud',promotion:policy.promotion},shippingDescription:()=>'',shippingPolicy:async()=>copy(policy),catalog:async()=>[copy(product)],address:()=>{calls.addressReads++;return copy(address)},money:n=>(n/100).toFixed(2),lineTitle:l=>l.name,shippingProgress:()=>({shippingHint:''}),cart:()=>copy(cart),saveCart:value=>cart=copy(value),err:e=>calls.errors.push(e.message),createOrder:async(items,a,token,options)=>{calls.orders.push(copy({items,address:a,token,options}));return {id:'order-1'}},...overrides};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../miniprogram/pages/checkout/index.js'),'utf8'),{require:name=>name.endsWith('/ui')?ui:name.endsWith('/domain')?domain:name.endsWith('/privacy')?privacy:name.endsWith('/consent-page')?consent:service,wx,Page:value=>page=value,Map});
 page.data=copy(page.data);page.setData=value=>Object.assign(page.data,copy(value));page.onLoad({source:'cart'});
 return {page,service,wx,storage,calls,consent(value){accepted=value}};
}
const mode=value=>({currentTarget:{dataset:{mode:value}}});
test('checkout waits for a complete quote, suppresses double submit and reopens a created order after a navigation failure',async()=>{
 const catalog=pending(),h=harness({catalog:()=>catalog.promise}),{page,calls}=h;
 await page.submit();const loading=page.reload();await tick();await page.submit();assert.equal(calls.orders.length,0);assert.equal(page.data.quoteReady,false);
 catalog.resolve([copy(product)]);await loading;assert.equal(page.data.total,'15.00');await page.submit();await page.submit();assert.equal(calls.orders.length,1);assert.equal(calls.orders[0].options.expectedTotal,1500);assert.equal(calls.orders[0].options.promotionRevision,1);
 calls.navigation[0].fail();assert.equal(page.data.orderCreated,true);await page.submit();assert.equal(calls.orders.length,1);assert.equal(calls.navigation.length,2);page.onUnload();
});
test('delivery-mode changes ignore old quotes and cannot submit while the new quote is pending',async()=>{
 const old=pending(),latest=pending();let n=0;const h=harness({catalog:()=>++n===1?old.promise:latest.promise}),{page,calls}=h;
 const first=page.reload();await tick();const second=page.mode(mode('pickup'));await tick();await page.submit();assert.equal(calls.orders.length,0);
 latest.resolve([copy(product)]);await second;assert.equal(page.data.shipping,'0.00');assert.equal(page.data.deliveryMode,'pickup');old.resolve([copy(product)]);await first;assert.equal(page.data.total,'10.00');assert.equal(page.quote.deliveryMode,'pickup');page.onUnload();
});
test('checkout ignores hidden-page responses and refreshes when shown again',async()=>{
 const stale=pending();let n=0;const {page}=harness({catalog:()=>++n===1?stale.promise:Promise.resolve([copy(product)])});const first=page.onShow();await tick();page.onHide();stale.resolve([copy(product)]);await first;assert.equal(page.data.quoteReady,false);await page.onShow();assert.equal(page.data.quoteReady,true);page.onUnload();
});
test('consent revoked during a quote prevents late contact reads and clears previously entered pickup fields',async()=>{
 for(const reject of [false,true]){
  const catalog=pending(),h=harness({catalog:()=>catalog.promise}),{page,calls}=h;page.setData({address:copy(address),pickupName:'已填写姓名',pickupPhone:address.phone});const request=page.reload();await tick();h.consent(false);
  if(reject)catalog.reject(new Error('offline'));else catalog.resolve([copy(product)]);await request;assert.equal(page.data.privacyAccepted,false);assert.equal(page.data.address,null);assert.equal(page.data.pickupName,'');assert.equal(page.data.pickupPhone,'');assert.equal(calls.addressReads,0);await page.submit();assert.equal(calls.orders.length,0);page.onUnload();
 }
});
test('temporary quote failures retain selected items and pickup input; retry recovers without creating an order',async()=>{
 let fail=false;const h=harness({catalog:async()=>{if(fail)throw new Error('网络暂时不可用');return [copy(product)]}}),{page,calls}=h;await page.reload();page.setData({pickupName:'自取联系人',pickupPhone:address.phone});fail=true;await page.mode(mode('pickup'));assert.equal(page.data.quoteReady,false);assert.equal(page.data.pickupName,'自取联系人');assert.equal(h.storage.get('checkout.v1').length,1);await page.submit();assert.equal(calls.orders.length,0);fail=false;await page.reload();assert.equal(page.data.total,'10.00');assert.equal(page.data.pickupPhone,address.phone);page.onUnload();
});
test('missing or insufficient-stock goods block the whole checkout instead of silently dropping a line',async()=>{
 for(const list of [[],[{...copy(product),skus:[{...copy(product.skus[0]),stock:0}]}]]){
  const {page,calls}=harness({catalog:async()=>list});await page.reload();assert.equal(page.data.quoteReady,false);assert.match(page.data.error,/下架|库存不足/);assert.equal(page.items.length,1);await page.submit();assert.equal(calls.orders.length,0);page.onUnload();
 }
});
test('new prices require a fresh review and are submitted with the current revision and exact total',async()=>{
 let newer=false;const {page,calls}=harness({shippingPolicy:async()=>({...copy(policy),revision:newer?2:1,promotion:{...policy.promotion,discountBps:newer?8880:5000}})});await page.reload();newer=true;await page.reload();assert.match(page.data.notice,/价格已更新/);assert.equal(page.data.total,'22.76');assert.equal(calls.orders.length,0);await page.submit();assert.equal(calls.orders[0].options.promotionRevision,2);assert.equal(calls.orders[0].options.expectedTotal,2276);page.onUnload();
});
test('a server stock conflict rechecks availability, preserves cart choices and never retries the purchase automatically',async()=>{
 let remaining=3,attempts=0;const h=harness({catalog:async()=>[{...copy(product),skus:[{...copy(product.skus[0]),stock:remaining}]}],createOrder:async()=>{attempts++;remaining=0;throw new Error('测试商品库存不足')}}),{page}=h;await page.reload();await page.submit();assert.equal(attempts,1);assert.equal(page.data.quoteReady,false);assert.match(page.data.error,/库存不足/);assert.equal(h.service.cart().length,1);assert.equal(h.storage.get('checkout.v1').length,1);await page.submit();assert.equal(attempts,1);page.onUnload();
});
test('successful checkout removes only purchased quantities and preserves other cart additions',async()=>{
 const {page,service}=harness();await page.reload();service.saveCart([{skuId:'item-sku',qty:3,selected:true},{skuId:'another-sku',qty:2,selected:false}]);await page.submit();assert.deepEqual(service.cart(),[{skuId:'item-sku',qty:2,selected:true},{skuId:'another-sku',qty:2,selected:false}]);page.onUnload();
});

test('rechecking a completed quote keeps the amount panel in place while submission stays disabled',async()=>{
 const slow=pending();let n=0;const {page,calls}=harness({catalog:()=>++n===1?Promise.resolve([copy(product)]):slow.promise});await page.reload();assert.equal(page.data.hasQuote,true);const updating=page.mode(mode('pickup'));await tick();assert.equal(page.data.loading,true);assert.equal(page.data.hasQuote,true);assert.equal(page.data.total,'15.00');assert.equal(page.data.quoteReady,false);await page.submit();assert.equal(calls.orders.length,0);slow.resolve([copy(product)]);await updating;assert.equal(page.data.total,'10.00');page.onUnload();
});
