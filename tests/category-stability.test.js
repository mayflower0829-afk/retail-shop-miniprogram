const applyDataPatch=require('./helpers/render-data');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const clone=v=>JSON.parse(JSON.stringify(v));
function harness(){
 const products=Array.from({length:45},(_,i)=>({id:'item-'+i,name:'商品'+i,displayName:'商品'+i,ip:'作品',group:'明谷',type:'吧唧',stock:1,image:'/assets/placeholder.jpg',priceText:'1.00',skus:[{id:'sku-'+i,name:'默认款'}]})),patches=[];
 const service={catalog:async()=>products,sortProducts:v=>v,err:e=>{throw e}},wx={getStorageSync(){},removeStorageSync(){}};
 const module={exports:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../miniprogram/utils/ui.js'),'utf8'),{module,wx,setTimeout,clearTimeout});
 let page;vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../miniprogram/pages/category/index.js'),'utf8'),{require:n=>n.endsWith('/ui')?module.exports:n.endsWith('/search')?require('../miniprogram/utils/search'):n.endsWith('/product-images')?{}:service,Page:p=>page=p,wx,Set});
 page.data=clone(page.data);page.setData=(patch,done)=>{patches.push(clone(patch));applyDataPatch(page.data,patch);if(done)done()};return {page,patches};
}
const event=value=>({currentTarget:{dataset:{value}}});
test('reselecting the active category controls preserves expanded cards and scroll position',async()=>{
 const {page,patches}=harness();try{
  await page.reload();page.more();page.scrolled({detail:{scrollTop:680}});const before=patches.length,ids=page.data.visible.map(p=>p.id);
  for(const field of ['ip','group','type'])page[field](event(page.data[field]));
  assert.equal(page.data.limit,40);assert.deepEqual(page.data.visible.map(p=>p.id),ids);assert.equal(page._catalogScrollTop,680);assert.equal(patches.length,before);
 }finally{page.onUnload()}
});
test('reselecting an active control does not cancel a pending search',async()=>{
 for(const field of ['ip','group','type']){
  const {page}=harness();try{
   await page.reload();page.more();page.scrolled({detail:{scrollTop:480}});page.search({detail:{value:'商品1'}});const timer=page._searchTimer;
   page[field](event(page.data[field]));assert.equal(page._searchTimer,timer);assert.equal(page.data.visible.length,40);assert.equal(page._catalogScrollTop,480);
   await new Promise(resolve=>setTimeout(resolve,160));assert.equal(page._searchTimer,null);assert.equal(page.data.resultCount,11);assert.equal(page.data.visible.length,11);assert.ok(page.data.visible.every(p=>p.displayName.includes('商品1')));assert.equal(page._catalogScrollTop,0);
  }finally{page.onUnload()}
 }
});
test('changing a category control still resets pagination and scroll to the matching first page',async()=>{
 for(const [field,value] of [['ip','作品'],['group','明谷'],['type','吧唧']]){
  const {page}=harness();try{
   await page.reload();page.more();page.scrolled({detail:{scrollTop:500}});page[field](event(value));
   assert.equal(page.data[field],value);assert.equal(page.data.limit,20);assert.equal(page.data.visible.length,20);assert.equal(page.data.resultCount,45);assert.equal(page._catalogScrollTop,0);assert.equal(page.data.catalogScrollTop,0);assert.equal(page.data.filtersActive,true);
  }finally{page.onUnload()}
 }
});
