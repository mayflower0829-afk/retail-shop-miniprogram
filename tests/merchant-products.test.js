const test=require('node:test'),assert=require('node:assert/strict');
const {harness,receipt}=require('./helpers/commerce-harness');
const management=require('../cloudfunctions/commerce/product-management'),promotion=require('../cloudfunctions/commerce/promotion'),settings=require('../cloudfunctions/commerce/shop-settings');
const domain=require('../cloudfunctions/commerce/domain'),imports=require('../cloudfunctions/commerce/product-import');
const ExcelJS=require('../cloudfunctions/commerce/node_modules/exceljs'),JSZip=require('../cloudfunctions/commerce/node_modules/jszip');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1cAAAAASUVORK5CYII=','base64');
const draft={name:'测试新品',price:'20.00',stock:7,group:'明谷',type:'吧唧',ip:'测试作品',description:'新品介绍',active:true};
function photo(h,key='upload-photo-1'){const path=management.filePath('admin','image',key,'png'),id='cloud://mock-env.bucket/'+path;h.files.set(id,png);return id;}
test('free discounts support decimals, original price, cent rounding and shipping after discount',()=>{
 for(const [input,bps] of [['3',3000],['7',7000],['8',8000],['9',9000],['8.8',8800],['8.85',8850],['8.888',8888],['10',10000]]){
  const p=promotion.parseDiscount(input);assert.equal(p.discountBps,bps);assert.equal(domain.salePrice(10000,p),bps);assert.equal(p.enabled,bps!==10000);
 }
 const p=promotion.parseDiscount('8.8'),products=[{id:'a',name:'a',active:true,skus:[{id:'s',price:7841,stock:5}]}];
 assert.equal(domain.quote(products,[{skuId:'s',qty:1}],{promotion:p,freeShipping:6900,shippingFee:500}).subtotal,6900);
 assert.equal(domain.quote(products,[{skuId:'s',qty:1}],{promotion:p,freeShipping:6900,shippingFee:500}).shippingFee,0);
 products[0].skus[0].price=7840;assert.equal(domain.quote(products,[{skuId:'s',qty:1}],{promotion:p,freeShipping:6900,shippingFee:500}).shippingFee,500);
 for(const input of ['0','-2','10.01','88','1e1','8.8888',8.8,'','NaN'])assert.throws(()=>promotion.parseDiscount(input));
});
test('only administrators can change promotion; failed storage cannot silently fall back to a stale price',async()=>{
 const h=harness();h.as('buyer');assert.equal((await h.main({action:'setPromotion',discount:'8.8'})).ok,false);assert.equal(h.collections.shop_settings.size,0);
 h.as('admin');assert.equal((await h.main({action:'shippingPolicy'})).data.promotion.discountBps,5000);
 assert.equal((await h.main({action:'setPromotion',discount:'8.8'})).ok,true);
 assert.equal((await h.main({action:'shippingPolicy'})).data.promotion.discountBps,8800);
 assert.equal((await h.main({action:'setPromotion',discount:'88'})).ok,false);
 assert.equal((await h.main({action:'shippingPolicy'})).data.promotion.discountBps,8800);
 await assert.rejects(()=>settings.read({collection(){throw new Error('network failure')}}),/network/);
});
test('order snapshots survive promotion changes and stale checkout never reserves inventory',async()=>{
 const h=harness();h.env.ENABLE_CHECKOUT='true';h.as('buyer');
 const event={action:'createOrder',items:[{skuId:'TESTSKU',qty:1}],token:'new-checkout-order-1',privacyConsent:receipt(),address:{name:'测试',phone:'13900000000',region:['北京','北京','东城'],detail:'测试地址一号'},promotionRevision:0,expectedTotal:1000};
 const original=await h.main(event);assert.equal(original.ok,true);assert.equal(original.data.total,1000);
 h.as('admin');const changed=await h.main({action:'setPromotion',discount:'8.8'});h.as('buyer');
 assert.equal((await h.main({...event,token:'new-checkout-order-2'})).ok,false);assert.equal(h.collections.products.get('TESTPRODUCT').skus[0].stock,7);
 const fresh=await h.main({...event,token:'new-checkout-order-2',promotionRevision:changed.data.revision,expectedTotal:1380});assert.equal(fresh.ok,true);assert.equal(fresh.data.total,1380);
 assert.equal(h.collections.orders.get(original.data.id).lines[0].price,500);assert.equal(h.collections.orders.get(original.data.id).promotion.discountBps,5000);
 const bad=await h.main({...event,token:'new-checkout-order-3',promotionRevision:changed.data.revision,expectedTotal:999});assert.equal(bad.ok,false);assert.equal(h.collections.orders.size,2);
});
test('new-product creation checks role, file ownership and values; retry after a sale never restocks',async()=>{
 const h=harness(),id=photo(h);const event={action:'createProduct',draft,imageFileID:id,token:'new-product-token'};
 h.as('visitor');assert.equal((await h.main(event)).ok,false);h.as('admin');
 assert.equal((await h.main({...event,imageFileID:id.replace('/merchant-image/','/wrong/')})).ok,false);
 const r=await h.main(event);assert.equal(r.ok,true);assert.equal(r.data.active,true);assert.equal(r.data.needsReview,false);assert.ok(!r.data._createdBy);assert.equal(r.data.skus[0].price,2000);
 const saved=h.collections.products.get(r.data.id);saved.skus[0].stock-=1;
 assert.equal((await h.main(event)).data.skus[0].stock,6);assert.equal(h.collections.products.size,2);
 assert.equal((await h.main({...event,draft:{...draft,stock:20}})).ok,false);
 for(const invalid of [{name:''},{stock:-1},{stock:0.5},{price:'0.01e3'},{active:'true'},{type:'invalid'}])assert.equal((await h.main({...event,token:'new-other-product',draft:{...draft,...invalid}})).ok,false);
 const publicCatalog=await h.main({action:'catalog'});assert.ok(!JSON.stringify(publicCatalog).includes('_creationSignature'));assert.match(publicCatalog.data.find(p=>p.id===r.data.id).image,/^https:/);
});
test('missing-photo drafts stay inactive, metadata edits preserve price and stock, and publication needs a photo',async()=>{
 const h=harness(),r=await h.main({action:'createProduct',draft,token:'draft-no-photo-1'});assert.equal(r.ok,true);assert.equal(r.data.active,false);
 const patch={skuId:r.data.skus[0].id,priceCents:2000,stockDelta:0,active:true,confirmForSale:true};
 assert.equal((await h.main({action:'updateProduct',id:r.data.id,patch,token:'publish-draft-1'})).ok,false);
 const edited=await h.main({action:'updateProductInfo',id:r.data.id,name:'补图商品',group:'明谷',type:'吧唧',description:'新介绍',ip:'测试',imageFileID:photo(h)});
 assert.equal(edited.ok,true);assert.equal(edited.data.active,false);assert.equal(edited.data.skus[0].stock,7);assert.equal(edited.data.skus[0].price,2000);
 assert.equal((await h.main({action:'updateProduct',id:r.data.id,patch,token:'publish-draft-1'})).ok,true);
});
async function workbook(){const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('商品');sheet.addRow(['商品名称','零售价','数量','商品分组','商品类型','IP']);sheet.addRow(['有图新品',20,3,'明谷','吧唧','作品']);sheet.addRow(['缺图新品','18.99',2,'明谷','立牌','作品']);sheet.addRow(['',10,1]);sheet.addRow(['错库存',10,1.5]);const image=book.addImage({buffer:png,extension:'png'});sheet.addImage(image,{tl:{col:6,row:1},ext:{width:20,height:20}});return Buffer.from(await book.xlsx.writeBuffer());}
test('Excel preview recognizes embedded pictures and reports invalid rows without dropping valid rows',async()=>{
 const buffer=await workbook(),parsed=await imports.parse(buffer);assert.equal(parsed.rows.length,2);assert.equal(parsed.photos.size,1);assert.equal(parsed.rows[0].hasImage,true);assert.equal(parsed.rows[1].hasImage,false);assert.equal(parsed.rows[1].priceCents,1899);assert.equal(parsed.errors.length,2);
 await assert.rejects(()=>imports.parse(Buffer.from('not an Excel file')));await assert.rejects(()=>imports.parse(Buffer.alloc(10*1024*1024+1)));
 const zip=await JSZip.loadAsync(buffer);zip.file('xl/externalLinks/externalLink1.xml','<externalLink/>');
 const bad=await zip.generateAsync({type:'nodebuffer'});await assert.rejects(()=>imports.parse(bad),/外部链接/);
});
test('Excel import is role guarded, resumes idempotently and cannot overwrite existing stock',async()=>{
 const h=harness(),buffer=await workbook(),fileID='cloud://mock-env.bucket/'+management.filePath('admin','import','import-file-token','xlsx');h.files.set(fileID,buffer);
 const preview=await h.main({action:'previewProductImport',fileID});assert.equal(preview.ok,true);assert.equal(preview.data.count,2);assert.equal(preview.data.drafts,1);assert.equal(h.collections.products.size,1);
 h.as('visitor');assert.equal((await h.main({action:'commitProductImport',jobId:preview.data.jobId,offset:0})).ok,false);h.as('admin');
 const imported=await h.main({action:'commitProductImport',jobId:preview.data.jobId,offset:0});assert.equal(imported.ok,true);assert.equal(imported.data.done,true);assert.equal(h.collections.products.size,3);
 const original=h.collections.products.get('TESTPRODUCT');assert.equal(original.skus[0].stock,8);
 const product=h.collections.products.get(imported.data.ids[0]);product.skus[0].stock=1;
 assert.equal((await h.main({action:'commitProductImport',jobId:preview.data.jobId,offset:0})).ok,true);assert.equal(h.collections.products.size,3);assert.equal(h.collections.products.get(product.id).skus[0].stock,1);
 const repeat=await h.main({action:'previewProductImport',fileID});assert.equal(repeat.data.jobId,preview.data.jobId);
 h.files.set(fileID,Buffer.from('changed'));assert.equal((await h.main({action:'commitProductImport',jobId:preview.data.jobId,offset:0})).ok,false);
});
test('wrong-owner and wrong-environment uploads never reach storage downloads',()=>{
 const id='cloud://mock-env.bucket/'+management.filePath('admin','image','upload-valid-key','png');
 assert.equal(management.verifyFileID(id,'admin','image','mock-env'),id);
 assert.throws(()=>management.verifyFileID(id,'buyer','image','mock-env'));
 assert.throws(()=>management.verifyFileID(id,'admin','import','mock-env'));
 assert.throws(()=>management.verifyFileID(id,'admin','image','other-env'));
 assert.throws(()=>management.imageExtension(Buffer.from('text pretending to be PNG')));
});
