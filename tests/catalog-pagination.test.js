const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const applyDataPatch=require('./helpers/render-data'),clone=v=>JSON.parse(JSON.stringify(v)),tick=()=>new Promise(resolve=>setImmediate(resolve));
const event=value=>({currentTarget:{dataset:{value}}});
const products=()=>Array.from({length:205},(_,i)=>({id:'item-'+i,name:'商品'+i,displayName:'商品'+i,ip:'作品',group:'明谷',type:'吧唧',stock:3,priceText:(i+1)+'.00',image:'/assets/placeholder.jpg',skus:[{id:'sku-'+i,name:'默认款',stock:3}]}));
function harness(name){
 let page;const patches=[],list=products(),policy={promotion:{title:'活动'}},service={config:{mode:'cloud',shopName:'测试',promotion:policy.promotion},shippingDescription:()=>'',shippingPolicy:async()=>policy,catalog:async()=>list,orders:async()=>[],favorites:()=>list.map(p=>p.id),sortProducts:(list,sort)=>sort==='desc'?[...list].reverse():list,err:()=>{}};
 const wx={getStorageSync(){},removeStorageSync(){}},module={exports:{}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../miniprogram/utils/ui.js'),'utf8'),{module,wx,setTimeout,clearTimeout});
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../miniprogram/pages',name,'index.js'),'utf8'),{Page:p=>page=p,wx,Set,Map,setTimeout,clearTimeout,require:n=>n.endsWith('/ui')?module.exports:n.endsWith('/search')?require('../miniprogram/utils/search'):n.endsWith('/product-images')?{}:service});
 page.data=clone(page.data);page.setData=(patch,done)=>{patches.push(clone(patch));applyDataPatch(page.data,patch);if(done)done()};return {page,patches,list,service};
}
for(const name of ['home','category']){
 test(name+': pagination transfers only new cards and stops at the last item',async()=>{
  const {page,patches,list}=harness(name);try{
   await page.reload();let transferred=page.data.visible.length;patches.length=0;
   while(page.data.hasMore){const start=page.data.visible.length,n=patches.length;page.more();const current=patches.slice(n),keys=current.flatMap(p=>Object.keys(p).filter(k=>/^visible\[\d+\]$/.test(k)));
    assert.ok(current.every(p=>!Object.hasOwn(p,'visible')));assert.deepEqual(keys,Array.from({length:Math.min(20,list.length-start)},(_,i)=>'visible['+(start+i)+']'));transferred+=keys.length;
    assert.deepEqual(page.data.visible.map(p=>p.id),list.slice(0,page.data.limit).map(p=>p.id));
   }
   assert.equal(transferred,205);assert.equal(new Set(page.data.visible.map(p=>p.id)).size,205);const n=patches.length;page.more();page.more();assert.equal(patches.length,n);
  }finally{page.onUnload()}
 });
 test(name+': pending search replaces the old cards before loading more',async()=>{
  const {page,patches}=harness(name);try{
   await page.reload();page.more();if(name==='category')page.scrolled({detail:{scrollTop:800}});
   page.search({detail:{value:'商品19'}});patches.length=0;page.more();assert.equal(page._searchTimer,null);
   assert.equal(page.data.visible.length,11);assert.ok(page.data.visible.every(p=>p.displayName.includes('商品19')));assert.equal(patches.filter(p=>Object.hasOwn(p,'visible')).length,1);
   if(name==='category')assert.equal(page._catalogScrollTop,0);const n=patches.length;await new Promise(resolve=>setTimeout(resolve,150));assert.equal(patches.length,n);
  }finally{page.onUnload()}
 });
 test(name+': a changed prefix refreshes stock, price, picture and SKU count instead of appending stale cards',async()=>{
  const {page,patches,list}=harness(name);try{
   await page.reload();Object.assign(list[0],{stock:0,priceText:'99.00',image:'/assets/new.jpg'});list[0].skus.push({id:'extra',name:'新增款'});patches.length=0;page.more();
   assert.equal(patches.filter(p=>Object.hasOwn(p,'visible')).length,1);assert.equal(page.data.visible.length,40);const first=page.data.visible[0];assert.equal(first.stock,0);assert.equal(first.priceText,'99.00');assert.equal(first.image,'/assets/new.jpg');assert.equal(first.skuCount,2);
  }finally{page.onUnload()}
 });
 test(name+': refresh, failures and a hidden page block stale pagination',async()=>{
  const {page,patches,service}=harness(name);try{
   await page.reload();page.more();let resolve;service.catalog=()=>new Promise(r=>resolve=r);const refresh=page.reload();await tick();let n=patches.length;page.more();assert.equal(patches.length,n);
   resolve(products().slice(0,3));await refresh;assert.equal(page.data.visible.length,3);assert.equal(page.data.hasMore,false);
   page.setData({error:'offline',hasMore:true});n=patches.length;page.more();assert.equal(patches.length,n);page.setData({error:''});page.onHide();n=patches.length;page.more();assert.equal(patches.length,n);
  }finally{page.onUnload()}
 });
}
test('removing a favorite refreshes the list without keeping an obsolete first card',async()=>{
 const {page,patches,list,service}=harness('home');try{
  await page.reload();page.filter(event('收藏'));service.favorites=()=>list.slice(1).map(p=>p.id);patches.length=0;page.more();assert.equal(patches.filter(p=>Object.hasOwn(p,'visible')).length,1);assert.equal(page.data.visible[0].id,'item-1');assert.equal(page.data.visible.length,40);
  page.sort({detail:{value:2}});assert.equal(page.data.visible[0].id,'item-204');assert.equal(page.data.visible.length,20);
 }finally{page.onUnload()}
});
