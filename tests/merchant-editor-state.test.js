const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const clone=v=>JSON.parse(JSON.stringify(v)),tick=()=>new Promise(resolve=>setImmediate(resolve));
const pending=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
const product=(id='item-a',name='星空系列')=>({id,name,ip:'星之旅',group:'明谷',type:'吧唧',active:true,needsReview:true,stock:3,image:'/test.png',hasDiscount:true,discountBps:8800,skus:[{id:id+'-one',name:'角色ＡＢＣ',price:2000,stock:3},{id:id+'-two',name:'角色DEF',price:1800,stock:2}]});
function editor(overrides={},deferRender=false){
 const calls={patches:[],errors:[],saves:[],history:[],navigation:[],toasts:[],scrolls:[],renders:[]};const wx={showToast:o=>calls.toasts.push(o),navigateTo:o=>calls.navigation.push(o),pageScrollTo:o=>calls.scrolls.push(clone(o))};
 const service={config:{mode:'cloud'},money:n=>(n/100).toFixed(2),adminProducts:async()=>[product()],ensureAdmin:async()=>{},inventoryHistory:async id=>{calls.history.push(id);return []},updateProduct:async(...args)=>calls.saves.push(args),err:e=>calls.errors.push(e.message),...overrides};
 const uiModule={exports:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../miniprogram/utils/ui.js'),'utf8'),{module:uiModule,wx,setTimeout,clearTimeout});let page;
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../miniprogram/pages/admin-products/index.js'),'utf8'),{Page:p=>page=p,require:name=>name.endsWith('/store')?service:name.endsWith('/ui')?uiModule.exports:require(path.join(__dirname,'../miniprogram/pages/admin-products',name)),wx});
 page.data=clone(page.data);page.setData=(value,callback)=>{calls.patches.push(clone(value));Object.assign(page.data,clone(value));if(callback){if(deferRender)calls.renders.push(callback);else callback()}};return {page,calls,service};
}
const edit=(page,id='item-a')=>page.edit({currentTarget:{dataset:{id}}});
const field=(page,name,value)=>page.field({currentTarget:{dataset:{field:name}},detail:{value}});
test('merchant catalogue renders only visible products and searches combined words, styles and identifiers',async()=>{
 const rows=Array.from({length:65},(_,i)=>product('item-'+i));rows[1].active=false;
 const {page,calls}=editor({adminProducts:async()=>rows});await page.reload();assert.equal(page.products.length,65);assert.equal(page.data.visible.length,20);assert.equal(Object.hasOwn(page.data,'products'),false);assert.ok(calls.patches.every(p=>!Object.hasOwn(p,'products')));
 page.more();assert.equal(page.data.visible.length,40);page.search({detail:{value:'星之旅 ABC item-1'}});page.confirmSearch();assert.equal(page.data.visible.length,11);assert.equal(page._searchTimer,null);
 page.filter({currentTarget:{dataset:{value:'inactive'}}});assert.equal(page.data.visible.length,1);page.clearSearch();assert.equal(page.data.filter,'inactive');assert.equal(page.data.keyword,'');assert.equal(page.data.visible.length,1);
 page.search({detail:{value:'不存在'}});page.resetFilters();assert.equal(page.data.visible.length,20);assert.equal(page.data.filtersActive,false);assert.equal(page._searchTimer,null);page.onUnload();
});
test('merchant refresh ignores older successes and failures, and cannot update a hidden page',async()=>{
 for(const fail of [false,true]){const old=pending();let n=0;const {page}=editor({adminProducts:()=>++n===1?old.promise:Promise.resolve([product('new')])});const load=page.reload();await page.reload();if(fail)old.reject(new Error('old offline'));else old.resolve([product('old')]);await load;assert.equal(page.data.visible[0].id,'new');assert.equal(page.data.error,'');page.onUnload()}
 const request=pending(),{page,calls}=editor({adminProducts:()=>request.promise});const load=page.reload();page.onHide();const before=calls.patches.length;request.resolve([product()]);await load;assert.equal(calls.patches.length,before);assert.deepEqual(page.data.visible,[]);
});
test('current merchant authorization failure clears product and editor data',async()=>{
 const {page,service}=editor();await page.reload();edit(page);service.adminProducts=async()=>{throw new Error('没有店铺管理权限')};await page.reload();assert.equal(page.products.length,0);assert.deepEqual(page.data.visible,[]);assert.equal(page.data.selected,null);assert.equal(page.data.resultCount,0);assert.match(page.data.error,/权限/);page.onUnload();
});
test('inventory history cannot cross products or reopen a closed editor and repeated taps make one request',async()=>{
 const old=pending(),fresh=pending();let n=0;const {page,service}=editor({adminProducts:async()=>[product('a'),product('b')],inventoryHistory:()=>++n===1?old.promise:fresh.promise});await page.reload();edit(page,'a');const first=page.history();await page.history();assert.equal(n,1);assert.equal(page.data.historyLoading,true);
 page.close();edit(page,'b');const second=page.history();old.resolve([{createdAt:1,skuName:'A record',stockDelta:1}]);await first;assert.deepEqual(page.data.history,[]);assert.equal(page.data.historyLoading,true);
 fresh.resolve([{createdAt:2,skuName:'B record',stockDelta:2}]);await second;assert.equal(page.data.history[0].skuName,'B record');assert.equal(page.data.historyLoading,false);
 const closed=pending();service.inventoryHistory=()=>closed.promise;page.close();edit(page,'a');const last=page.history();page.close();closed.resolve([{createdAt:3,skuName:'Closed record'}]);await last;assert.equal(page.data.selected,null);assert.deepEqual(page.data.history,[]);assert.equal(page.data.historyOpen,false);page.onUnload();
});
test('obsolete inventory history failures do not display errors after changing products',async()=>{
 const response=pending(),{page,calls}=editor({adminProducts:async()=>[product('a'),product('b')],inventoryHistory:()=>response.promise});await page.reload();edit(page,'a');const load=page.history();page.close();edit(page,'b');response.reject(new Error('A failed'));await load;assert.deepEqual(calls.errors,[]);assert.equal(page.data.historyOpen,false);assert.equal(page.data.historyLoading,false);page.onUnload();
});
test('saving freezes edits and preserves the same retry token after an uncertain response',async()=>{
 const response=pending();let n=0;const {page,calls}=editor({updateProduct:async(...args)=>{calls.saves.push(clone(args));if(++n===1)return response.promise}});await page.reload();edit(page);field(page,'stockDelta','2');page.confirmForSale({detail:{value:['confirmed']}});const save=page.save(),token=page.token,snapshot=clone(page.data);
 field(page,'price','99');field(page,'stockDelta','3');page.sku({detail:{value:'1'}});page.active({detail:{value:false}});page.confirmForSale({detail:{value:[]}});page.close();edit(page);await page.save();
 for(const key of ['selected','price','stockDelta','skuIndex','active','confirmForSale'])assert.deepEqual(page.data[key],snapshot[key]);assert.equal(page.token,token);assert.equal(calls.saves.length,1);
 response.reject(new Error('连接中断'));await save;assert.equal(page.data.busy,false);assert.equal(page.token,token);await page.save();assert.equal(calls.saves.length,2);assert.equal(calls.saves[1][2],token);assert.deepEqual(calls.saves[1][1],calls.saves[0][1]);assert.equal(calls.saves[0][1].confirmForSale,true);page.onUnload();
});
test('invalid SKU and unexpected field events cannot overwrite the product editor',async()=>{
 const {page}=editor();await page.reload();edit(page);page.token='keep';page.sku({detail:{value:'500'}});field(page,'selected',null);assert.equal(page.data.skuIndex,0);assert.equal(page.data.selected.id,'item-a');assert.equal(page.token,'keep');page.onUnload();
});
test('a failed photo batch rolls back only its new cache files and never adds hidden upload photos',async()=>{
 let page,n=0;const removed=[],errors=[],old={path:'/saved/old.png',fileID:'cloud://demo/old',existing:true};
 const service={config:{mode:'cloud'},ensureAdmin:async()=>{},requestToken:()=>String(++n),err:e=>errors.push(e.message)};
 const cache={cachePhoto:async(file,token)=>{if(file.fail)throw new Error('商品图片需小于8MB');return {path:'/cache/'+token+'.png',cached:true,token}},remove:p=>removed.push(p.path)};
 const wx={showActionSheet:({success})=>success({tapIndex:2}),chooseMessageFile:({success})=>success({tempFiles:[{name:'ok.png',size:1},{name:'bad.png',size:9000000,fail:true}]})};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../miniprogram/merchant/new-product/index.js'),'utf8'),{Page:p=>page=p,wx,require:name=>name.endsWith('/store')?service:name.endsWith('/merchant-draft')?cache:name.endsWith('/product-draft')?{TYPES:[]}:{} });
 page.data=clone(page.data);page.setData=v=>Object.assign(page.data,clone(v));page.onLoad({});page.photoItems=[old];page.setData({authorized:true,photos:[{path:old.path}],name:'保留新品名称'});const token=page.token;await page.photo();
 assert.equal(removed.length,1);assert.match(removed[0],/^\/cache\//);assert.deepEqual(page.photoItems,[old]);assert.deepEqual(page.data.photos,[{path:old.path}]);assert.equal(page.data.name,'保留新品名称');assert.equal(page.token,token);assert.equal(page.photosChanged,undefined);assert.equal(page.data.busy,false);assert.match(errors[0],/8MB/);
});

test('returning during a merchant save refreshes once after completion and clears the saved form',async()=>{
 const response=pending();let reads=0;const {page,calls}=editor({adminProducts:async()=>{reads++;return [product()]},updateProduct:()=>response.promise});await page.reload();edit(page);field(page,'stockDelta','2');const saving=page.save(),token=page.token;
 page.onHide();await page.onShow();assert.equal(reads,1);assert.equal(page.data.busy,true);assert.equal(page.token,token);response.resolve({});await saving;
 assert.equal(reads,2);assert.equal(page.data.busy,false);assert.equal(page.data.loading,false);assert.equal(page.data.selected,null);assert.equal(calls.toasts.length,1);assert.equal(page.token,token);page.onUnload();
});
test('a merchant save completing while hidden never updates the page until returning',async()=>{
 const response=pending();let reads=0;const {page,calls}=editor({adminProducts:async()=>{reads++;return [product()]},updateProduct:()=>response.promise});await page.reload();edit(page);const saving=page.save();page.onHide();const before=calls.patches.length;response.resolve({});await saving;
 assert.equal(calls.patches.length,before);assert.equal(calls.toasts.length,0);assert.equal(reads,1);await page.onShow();assert.equal(page.data.selected,null);assert.equal(page.data.busy,false);assert.equal(page.data.loading,false);assert.equal(reads,2);assert.equal(calls.toasts.length,1);page.onUnload();
});
test('leaving during the post-save refresh cannot leave loading stuck or restore stale products',async()=>{
 const refresh=pending();let reads=0;const {page,calls}=editor({adminProducts:()=>{reads++;return reads===2?refresh.promise:Promise.resolve([product(reads===1?'item-a':'latest')])}});await page.reload();edit(page);const saving=page.save();await tick();assert.equal(page.data.loading,true);
 page.onHide();await page.onShow();assert.equal(reads,3);assert.equal(page.data.loading,false);assert.equal(page.data.selected,null);assert.equal(page.data.visible[0].id,'latest');const before=calls.patches.length;refresh.resolve([product('outdated')]);await saving;
 assert.equal(calls.patches.length,before);assert.equal(calls.toasts.length,0);assert.equal(page.data.loading,false);assert.equal(page.data.visible[0].id,'latest');page.onUnload();
});
test('a failed merchant save after returning refreshes authorization and preserves editable input and retry token',async()=>{
 const response=pending();let reads=0;const {page,calls}=editor({adminProducts:async()=>{reads++;return [product()]},updateProduct:()=>response.promise});await page.reload();edit(page);field(page,'stockDelta','2');const saving=page.save(),token=page.token;
 page.onHide();await page.onShow();response.reject(new Error('连接中断'));await saving;assert.equal(reads,2);assert.equal(page.data.busy,false);assert.equal(page.data.loading,false);assert.equal(page.data.selected.id,'item-a');assert.equal(page.data.stockDelta,'2');assert.equal(page.token,token);assert.deepEqual(calls.errors,['连接中断']);assert.equal(calls.toasts.length,0);page.onUnload();
});
test('a merchant save finishing after unload cannot update the closed page or show a toast',async()=>{
 const response=pending(),{page,calls}=editor({updateProduct:()=>response.promise});await page.reload();edit(page);const saving=page.save();page.onUnload();const before=calls.patches.length;response.resolve({});await saving;assert.equal(calls.patches.length,before);assert.equal(calls.toasts.length,0);
});

test('editing a scrolled merchant list opens at the top after rendering and returns to the saved list position',async()=>{
 const {page,calls}=editor({},true);await page.reload();page.onPageScroll({scrollTop:1450});edit(page);assert.deepEqual(calls.scrolls,[]);page.onPageScroll({scrollTop:0});calls.renders.shift()();assert.deepEqual(calls.scrolls,[{scrollTop:0,duration:0}]);
 page.onPageScroll({scrollTop:300});page.close();page.onPageScroll({scrollTop:0});assert.equal(calls.scrolls.length,1);calls.renders.shift()();assert.deepEqual(calls.scrolls[1],{scrollTop:1450,duration:0});page.onUnload();
});
test('obsolete and hidden merchant render callbacks cannot scroll another view',async()=>{
 const {page,calls}=editor({},true);await page.reload();page.onPageScroll({scrollTop:980});edit(page);const old=calls.renders.shift();page.close();const back=calls.renders.shift();old();assert.deepEqual(calls.scrolls,[]);page.onHide();back();assert.deepEqual(calls.scrolls,[]);
 await page.onShow();const resumed=calls.renders.shift();assert.deepEqual(calls.scrolls,[]);resumed();assert.deepEqual(calls.scrolls,[{scrollTop:980,duration:0}]);page.onUnload();
});
test('successful merchant saves restore the list after its refreshed content finishes rendering',async()=>{
 const refresh=pending();let reads=0;const {page,calls}=editor({adminProducts:()=>++reads===2?refresh.promise:Promise.resolve([product()])},true);await page.reload();page.onPageScroll({scrollTop:1220});edit(page);calls.renders.shift()();const saving=page.save();await tick();assert.equal(page.data.loading,true);assert.equal(calls.scrolls.length,1);
 refresh.resolve([product()]);await saving;assert.equal(page.data.selected,null);assert.equal(calls.scrolls.length,1);calls.renders.shift()();assert.deepEqual(calls.scrolls[1],{scrollTop:1220,duration:0});page.onUnload();
});
test('a save completed while hidden restores the merchant list position only after returning and rendering',async()=>{
 const response=pending(),{page,calls}=editor({updateProduct:()=>response.promise},true);await page.reload();page.onPageScroll({scrollTop:750});edit(page);calls.renders.shift()();const saving=page.save();page.onHide();response.resolve({});await saving;assert.equal(calls.scrolls.length,1);await page.onShow();assert.equal(calls.scrolls.length,1);calls.renders.shift()();assert.deepEqual(calls.scrolls[1],{scrollTop:750,duration:0});page.onUnload();
});
