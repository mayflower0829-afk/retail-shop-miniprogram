const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function harness(){
 const calls={patches:[],previews:[]};let photos=['https://example.com/a.jpg','https://example.com/b.jpg','https://example.com/c.jpg'];
 const store={config:{mode:'demo'},shippingPolicy:async()=>({}),catalog:async()=>[{id:'demo-item',displayName:'示例商品',gallery:photos,skus:[{id:'demo-sku',stock:3,price:1000,salePrice:500}]}],shippingDescription:()=>'',money:n=>(n/100).toFixed(2),favorites:()=>[],err:e=>{throw e}};
 const ui={request:p=>p._request=(p._request||0)+1,current:(p,n)=>p._request===n};
 const images={galleryFor:p=>p.gallery,hasImage:()=>true,previewGallery:async(urls,index)=>calls.previews.push({urls,index})};
 const module={exports:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../miniprogram/utils/detail-page.js'),'utf8'),{module,require:name=>name==='./store'?store:name==='./ui'?ui:images});
 const page=module.exports('');page.id='demo-item';page.setData=value=>{Object.assign(page.data,value);calls.patches.push(value)};
 return {page,calls,photos:v=>photos=v};
}
test('gallery gestures update the counter without redundant patches or invalid indexes',async()=>{
 const {page,calls}=harness();await page.reload();const count=calls.patches.length;
 page.galleryChange({detail:{current:1}});assert.equal(page.data.galleryIndex,1);assert.equal(calls.patches.length,count+1);
 for(const current of [1,-1,4,1.5,'bad'])page.galleryChange({detail:{current}});assert.equal(page.data.galleryIndex,1);assert.equal(calls.patches.length,count+1);
 await page.preview({currentTarget:{dataset:{index:1}}});assert.equal(calls.previews[0].index,1);assert.equal(calls.previews[0].urls[1],'https://example.com/b.jpg');
});
test('a gallery refresh keeps its selected picture when possible and clamps when pictures are removed',async()=>{
 const {page,photos}=harness();await page.reload();page.galleryChange({detail:{current:2}});await page.reload();assert.equal(page.data.galleryIndex,2);
 photos(['https://example.com/a.jpg']);await page.reload();assert.equal(page.data.galleryIndex,0);assert.equal(page.data.gallery.length,1);
 photos([]);await page.reload();assert.equal(page.data.galleryIndex,0);
});
