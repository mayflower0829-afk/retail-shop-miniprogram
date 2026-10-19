const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function harness(){
 const calls={patches:[],previews:[],catalog:0};let skus=[{id:'demo-sku',stock:3,price:1000,salePrice:500}],preview,catalogWait;let photos=['https://example.com/a.jpg','https://example.com/b.jpg','https://example.com/c.jpg'];
 const store={config:{mode:'demo'},shippingPolicy:async()=>({}),catalog:async()=>{calls.catalog++;if(catalogWait)await catalogWait;return [{id:'demo-item',displayName:'示例商品',gallery:photos,skus}]},shippingDescription:()=>'',money:n=>(n/100).toFixed(2),favorites:()=>[],err:e=>{throw e}};
 const ui={request:p=>p._request=(p._request||0)+1,current:(p,n)=>!p._viewHidden&&p._request===n,resume:p=>{p._viewHidden=false},suspend:p=>{p._viewHidden=true;p._request=(p._request||0)+1}};
 const images={galleryFor:p=>p.gallery,hasImage:()=>true,previewGallery:async(urls,index)=>{calls.previews.push({urls,index});if(preview)return preview()}};
 const module={exports:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../miniprogram/utils/detail-page.js'),'utf8'),{module,require:name=>name==='./store'?store:name==='./ui'?ui:images});
 const page=module.exports('');page.id='demo-item';page.setData=(value,done)=>{Object.assign(page.data,value);calls.patches.push(value);if(done)done()};
 return {page,calls,photos:v=>photos=v,skus:v=>skus=v,preview:v=>preview=v,catalogWait:v=>catalogWait=v};
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

const sku=(id,stock)=>({id,stock,price:1000,salePrice:500}),select=id=>({currentTarget:{dataset:{id}}});
test('refresh preserves the selected style and clamps quantity to current stock',async()=>{
 const {page,skus}=harness();skus([sku('first',3),sku('second',6)]);await page.reload();page.select(select('second'));page.setData({qty:5});
 skus([sku('first',3),sku('second',2)]);await page.reload();assert.equal(page.data.sku.id,'second');assert.equal(page.data.qty,2);
 skus([sku('first',3),sku('second',0)]);await page.reload();assert.equal(page.data.sku.id,'second');assert.equal(page.data.qty,1);assert.equal(page.data.sku.stock,0);
 page.setData({qty:2});skus([sku('first',3)]);await page.reload();assert.equal(page.data.sku.id,'first');assert.equal(page.data.qty,1);
});
test('image retry refreshes URLs once, retains the visible gallery during loading and remounts on success',async()=>{
 const {page,calls,skus,photos,catalogWait}=harness();skus([sku('first',3),sku('second',6)]);await page.reload();page.select(select('second'));page.setData({qty:4,galleryIndex:2});
 const gallery=page.data.gallery,selected=page.data.sku.id,requests=calls.catalog;let resolve;catalogWait(new Promise(done=>{resolve=done}));page.imageFailed();
 const retry=page.retryImage();await page.retryImage();await new Promise(done=>setImmediate(done));assert.equal(calls.catalog,requests+1);assert.equal(page.data.loading,true);assert.equal(page.data.gallery,gallery);assert.equal(page.data.sku.id,selected);assert.equal(page.data.qty,4);
 const patches=calls.patches.length;photos(['https://example.com/new-a.jpg','https://example.com/new-b.jpg','https://example.com/new-c.jpg']);resolve();await retry;
 assert.ok(calls.patches.slice(patches).some(p=>Array.isArray(p.gallery)&&!p.gallery.length));assert.equal(page.data.gallery[2],'https://example.com/new-c.jpg');assert.equal(page.data.galleryIndex,2);assert.equal(page.data.sku.id,selected);assert.equal(page.data.qty,4);assert.equal(page.data.imageError,'');assert.equal(page.data.loading,false);
});
test('a failed image URL refresh preserves the original gallery and can be retried',async()=>{
 const {page,calls,catalogWait}=harness();await page.reload();const gallery=page.data.gallery;catalogWait(Promise.reject(new Error('temporary offline')));await page.retryImage();assert.equal(page.data.gallery,gallery);assert.equal(page.data.error,'temporary offline');assert.equal(page.data.loading,false);
 catalogWait(null);await page.retryImage();assert.equal(calls.catalog,3);assert.equal(page.data.error,'');assert.equal(page.data.gallery,gallery);assert.equal(page.data.loading,false);
});
test('tapping the selected or removed style leaves quantity and price unchanged',async()=>{
 const {page,calls}=harness();await page.reload();page.setData({qty:3});const before=calls.patches.length,price=page.data.price;
 page.select(select('demo-sku'));page.select(select('removed-style'));assert.equal(page.data.qty,3);assert.equal(page.data.price,price);assert.equal(calls.patches.length,before);
});
test('rapid preview taps open once and a failed preview can be retried',async()=>{
 const {page,calls,preview}=harness();await page.reload();let reject;preview(()=>new Promise((_,fail)=>{reject=fail}));const event={currentTarget:{dataset:{index:1}}};
 const first=page.preview(event),failed=assert.rejects(first,/图片预览失败/);await page.preview(event);assert.equal(calls.previews.length,1);reject(new Error('copy failed'));await failed;assert.equal(page._previewing,false);
 preview(null);await page.preview(event);assert.equal(calls.previews.length,2);assert.equal(page._previewing,false);page._viewHidden=true;await page.preview(event);assert.equal(calls.previews.length,2);
});


test('leaving during image retry keeps the gallery and returning resumes the interrupted load',async()=>{
 const {page,catalogWait,photos}=harness();await page.reload();const oldGallery=page.data.gallery;let resolve;catalogWait(new Promise(done=>{resolve=done}));
 const retry=page.retryImage();await new Promise(done=>setImmediate(done));page.onHide();photos(['https://example.com/refreshed.jpg']);resolve();await retry;
 assert.equal(page.data.gallery,oldGallery);catalogWait(null);await page.onShow();assert.equal(page.data.gallery[0],'https://example.com/refreshed.jpg');assert.equal(page.data.loading,false);
});
test('a delayed image remount cannot overwrite a newer detail refresh',async()=>{
 const {page,photos}=harness();await page.reload();const setData=page.setData;let remount;
 page.setData=(patch,done)=>{setData(patch);if(done)remount=done};const retry=page.retryImage();await new Promise(done=>setImmediate(done));assert.equal(typeof remount,'function');
 photos(['https://example.com/latest.jpg']);await page.reload();remount();await retry;assert.equal(page.data.gallery[0],'https://example.com/latest.jpg');assert.equal(page.data.loading,false);
});
