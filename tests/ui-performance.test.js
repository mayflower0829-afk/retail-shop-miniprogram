const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const clone=v=>JSON.parse(JSON.stringify(v)),tick=()=>new Promise(resolve=>setImmediate(resolve));
const pending=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
const policy={promotion:{enabled:true,discountBps:5000,title:'全场五折'},freeShipping:6900,shippingFee:500};
const product=(id='item-1',name='商品')=>({id,name,displayName:name,ip:'作品',group:'明谷',type:'吧唧',stock:3,priceText:'10.00',image:'/assets/placeholder.jpg',skus:[{id:id+'-sku',name:'默认款',stock:3,price:2000,salePrice:1000}]});
function harness(file,overrides={}){
 const calls={navigation:[],patches:[],errors:[]};let cart=[];
 const wx={getStorageSync(){},removeStorageSync(){},setStorageSync(){},showToast(){},navigateTo:o=>calls.navigation.push(o),switchTab:o=>calls.navigation.push(o)};
 const service={config:{mode:'cloud',shopName:'测试店铺',promotion:policy.promotion},shippingDescription:()=>'',shippingPolicy:async()=>policy,catalog:async()=>[product()],orders:async()=>[],favorites:()=>[],sortProducts:v=>v,money:n=>(n/100).toFixed(2),cart:()=>clone(cart),saveCart:v=>cart=clone(v),shippingProgress:subtotal=>({shippingProgress:Math.min(100,subtotal/69),shippingHint:String(subtotal)}),orderStatusName:o=>o.status,lineTitle:l=>l.name,err:e=>calls.errors.push(e.message),...overrides};
 const uiModule={exports:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../miniprogram/utils/ui.js'),'utf8'),{module:uiModule,wx,setTimeout,clearTimeout});
 const images=require('../miniprogram/utils/product-images');let page;
 const requireLocal=name=>name.endsWith('/ui')?uiModule.exports:name.endsWith('/product-images')?images:name.endsWith('/search')?require('../miniprogram/utils/search'):service;
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../miniprogram',file),'utf8'),{require:requireLocal,wx,Page:v=>page=v,setTimeout,clearTimeout,Map,Set});
 page.data=clone(page.data);page.setData=(v,done)=>{calls.patches.push(clone(v));Object.assign(page.data,clone(v));if(done)done()};return {page,calls,service,wx};
}
test('catalogues keep the full source off the rendering bridge and transfer only visible cards',async()=>{
 for(const name of ['home','category']){const list=Array.from({length:65},(_,i)=>product('item-'+i));const {page,calls}=harness('pages/'+name+'/index.js',{catalog:async()=>list});await page.reload();assert.equal(page.products.length,65);assert.equal(page.data.visible.length,20);assert.ok(calls.patches.every(p=>!Object.hasOwn(p,'products')));page.more();assert.equal(page.data.visible.length,40);page.onUnload()}
});
test('a slow order-history request cannot delay the first home catalogue',async()=>{
 const history=pending(),{page}=harness('pages/home/index.js',{orders:()=>history.promise});const loading=page.reload();await tick();assert.equal(page.data.visible.length,1);assert.equal(page.data.loading,false);history.resolve([{status:'paid',lines:[{productId:'item-1'}]}]);await loading;assert.ok(page.data.filters.includes('买过'));page.onUnload();
});
test('late catalogue responses cannot overwrite a newer refresh or update a hidden page',async()=>{
 for(const name of ['home','category']){const first=pending();let n=0;const {page}=harness('pages/'+name+'/index.js',{catalog:()=>++n===1?first.promise:Promise.resolve([product('latest')])});const old=page.reload();await tick();await page.reload();first.resolve([product('outdated')]);await old;assert.equal(page.data.visible[0].id,'latest');const hidden=pending();page.products=[];page.setData({visible:[]});const ctx=harness('pages/'+name+'/index.js',{catalog:()=>hidden.promise});const req=ctx.page.reload();await tick();ctx.page.onHide();hidden.resolve([product()]);await req;assert.equal(ctx.page.data.visible.length,0);page.onUnload();ctx.page.onUnload()}
});
test('typing coalesces list work and leaving cancels a queued search',async()=>{
 const {page}=harness('pages/home/index.js',{catalog:async()=>[product('a','星星'),product('b','月亮')]});await page.reload();let updates=0;const apply=page.apply;page.apply=function(){updates++;return apply.call(this)};
 for(const text of ['月','月亮'])page.search({detail:{value:text}});assert.equal(updates,0);await new Promise(resolve=>setTimeout(resolve,150));assert.equal(updates,1);assert.equal(page.data.visible[0].id,'b');page.search({detail:{value:'星'}});page.onHide();await new Promise(resolve=>setTimeout(resolve,150));assert.equal(updates,1);page.onUnload();
});
test('product cards open their image package directly, suppress double taps and allow retry after a navigation failure',()=>{
 const {page,calls}=harness('pages/home/index.js'),images=require('../miniprogram/utils/product-images'),id=Object.keys(require('../miniprogram/data/image-assets'))[0],event={currentTarget:{dataset:{id}}};page.detail(event);page.detail(event);assert.equal(calls.navigation.length,1);assert.equal(calls.navigation[0].url,images.detailUrl(id));assert.ok(!calls.navigation[0].url.startsWith('/pages/detail/'));calls.navigation[0].fail();page.detail(event);assert.equal(calls.navigation.length,2);page.onUnload();
});
test('cart quantities and selection update immediately without another cloud request; stock limits stay enforced',async()=>{
 let catalogue=0,policies=0;const {page,service}=harness('pages/cart/index.js',{shippingPolicy:async()=>{policies++;return policy},catalog:async()=>{catalogue++;return [product()]}});service.saveCart([{skuId:'item-1-sku',qty:1,selected:true}]);await page.reload();const event=delta=>({currentTarget:{dataset:{id:'item-1-sku',delta}}});page.qty(event(1));assert.equal(page.data.total,'20.00');page.qty(event(1));page.qty(event(1));assert.equal(page.data.lines[0].qty,3);page.toggle(event(0));assert.equal(page.data.count,0);page.remove(event(0));assert.equal(page.data.lines.length,0);assert.equal(catalogue,1);assert.equal(policies,1);page.onUnload();
});
test('order refresh keeps existing rows while loading; changing status clears them and ignores an obsolete response',async()=>{
 const next=pending();let n=0;const o={id:'existing-order',createdAt:1,status:'pending',total:100,lines:[]};const {page}=harness('pages/orders/index.js',{orderPage:()=>++n===1?Promise.resolve({orders:[o],hasMore:false,nextOffset:20}):n===2?next.promise:Promise.resolve({orders:[],hasMore:false,nextOffset:20})});await page.reload();const refresh=page.reload();assert.equal(page.data.visible[0].id,o.id);assert.equal(page.data.loading,true);await page.filter({currentTarget:{dataset:{id:'paid'}}});assert.equal(page.data.visible.length,0);next.resolve({orders:[o],hasMore:false,nextOffset:20});await refresh;assert.equal(page.data.visible.length,0);assert.equal(page.data.status,'paid');page.onUnload();
});

test('multi-keyword search includes style names and fullwidth Latin text; clearing and resetting cancels pending searches',async()=>{
 const search=require('../miniprogram/utils/search'),p={...product('a','海风系列'),ip:'星空计划',skus:[{name:'角色ＡＢＣ限定款'}]};
 assert.equal(search.matcher('星空 ABC 限定')(p),true);assert.equal(search.matcher('星空 不存在')(p),false);assert.equal(search.matcher('　')(p),true);
 for(const name of ['home','category']){
  const {page}=harness('pages/'+name+'/index.js',{catalog:async()=>[p,product('b','另一个系列')]});await page.reload();
  page.search({detail:{value:'星空 ＡＢＣ'}});page.confirmSearch();assert.equal(page.data.visible.length,1);assert.equal(page.data.visible[0].id,'a');assert.equal(page._searchTimer,null);
  if(name==='home')page.setData({onlyStock:true});else page.setData({type:'吧唧'});
  page.clearSearch();assert.equal(page.data.keyword,'');assert.equal(name==='home'?page.data.onlyStock:page.data.type,name==='home'?true:'吧唧');
  page.search({detail:{value:'不存在'}});page.resetFilters();assert.equal(page.data.visible.length,2);assert.equal(page.data.filtersActive,false);assert.equal(page._searchTimer,null);page.onUnload();
 }
});
test('cart cleanup removes only unavailable styles, preserves reduced-stock quantities and reads the latest cart after confirmation',async()=>{
 const available=product(),sold=product('sold'),extra=product('extra');sold.skus[0].stock=0;
 const {page,service,wx}=harness('pages/cart/index.js',{catalog:async()=>[available,sold,extra]});let modal;
 wx.showModal=options=>modal=options;service.saveCart([{skuId:'item-1-sku',qty:5,selected:true},{skuId:'sold-sku',qty:1,selected:true},{skuId:'missing-sku',qty:1,selected:true}]);await page.reload();
 assert.equal(page.data.unavailableCount,2);assert.equal(page.data.invalidSelectedCount,3);assert.match(page.data.lines[0].invalidReason,/仅剩3件/);
 page.cleanUnavailable();service.saveCart([...service.cart(),{skuId:'extra-sku',qty:1,selected:false},{skuId:'just-added-sku',qty:1,selected:false}]);modal.success({confirm:false});modal.complete();assert.equal(service.cart().length,5);
 page.cleanUnavailable();modal.success({confirm:true});modal.complete();assert.deepEqual(service.cart().map(i=>i.skuId),['item-1-sku','extra-sku','just-added-sku']);assert.equal(service.cart()[0].qty,5);assert.equal(page.data.invalidSelectedCount,1);page.onUnload();
});
test('cart checkout blocks selected items with insufficient stock and blocks stale data during a refresh',async()=>{
 const {page,service,calls}=harness('pages/cart/index.js');service.saveCart([{skuId:'item-1-sku',qty:4,selected:true}]);await page.reload();page.checkout();assert.equal(calls.navigation.length,0);
 page.setData({loading:true});page.checkout();assert.equal(calls.navigation.length,0);page.setData({loading:false,error:'offline'});page.checkout();assert.equal(calls.navigation.length,0);page.onUnload();
});

test('a cart quantity above remaining stock can be reduced until it is buyable',async()=>{
 const {page,service}=harness('pages/cart/index.js');service.saveCart([{skuId:'item-1-sku',qty:5,selected:true}]);await page.reload();const e={currentTarget:{dataset:{id:'item-1-sku',delta:-1}}};page.qty(e);assert.equal(page.data.lines[0].qty,4);assert.equal(page.data.lines[0].invalid,true);page.qty(e);assert.equal(page.data.lines[0].qty,3);assert.equal(page.data.lines[0].invalid,false);assert.equal(page.data.count,3);page.onUnload();
});

test('category filters reset the inner scroll while pagination and refresh preserve it',async()=>{
 const {page,calls}=harness('pages/category/index.js',{catalog:async()=>Array.from({length:45},(_,i)=>product('item-'+i))});await page.reload();
 const resetCount=()=>calls.patches.filter(p=>Object.hasOwn(p,'catalogScrollTop')).length;
 page.scrolled({detail:{scrollTop:680}});page.ip({currentTarget:{dataset:{value:'作品'}}});assert.equal(page.data.catalogScrollTop,0);assert.deepEqual(calls.patches.filter(p=>Object.hasOwn(p,'catalogScrollTop')).map(p=>p.catalogScrollTop),[680,0]);
 page.scrolled({detail:{scrollTop:420}});const before=resetCount();page.more();await page.reload();assert.equal(resetCount(),before);assert.equal(page._catalogScrollTop,420);
 page.search({detail:{value:'商品'}});page.confirmSearch();assert.equal(page._catalogScrollTop,0);assert.equal(resetCount(),before+2);
 page.scrolled({detail:{scrollTop:200}});page.clearSearch();assert.equal(page.data.catalogScrollTop,0);assert.equal(resetCount(),before+4);page.onUnload();
});
test('a queued category scroll reset cannot move a hidden page or supersede a newer reset',async()=>{
 const {page}=harness('pages/category/index.js');await page.reload();const callbacks=[];page.setData=(v,done)=>{Object.assign(page.data,clone(v));if(done)callbacks.push(done)};
 page.scrolled({detail:{scrollTop:600}});page.ip({currentTarget:{dataset:{value:'作品'}}});page.scrolled({detail:{scrollTop:300}});page.resetFilters();callbacks[0]();assert.equal(page.data.catalogScrollTop,300);page.onHide();callbacks[1]();assert.equal(page.data.catalogScrollTop,300);page.onUnload();
});
