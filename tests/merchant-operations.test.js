const test=require('node:test'),assert=require('node:assert/strict');
const {harness}=require('./helpers/commerce-harness'),ops=require('../cloudfunctions/commerce/merchant-operations'),analytics=require('../cloudfunctions/commerce/shop-analytics');
const ExcelJS=require('../cloudfunctions/commerce/node_modules/exceljs'),JSZip=require('../cloudfunctions/commerce/node_modules/jszip');
test('shop order search includes delivery and pickup contacts, escapes patterns and filters before pagination',async()=>{
 const h=harness();for(let i=0;i<25;i++)h.collections.orders.set('ORDER'+i,{_id:'ORDER'+i,id:'ORDER'+i,createdAt:i,status:'paid',deliveryMode:i%2?'pickup':'delivery',address:{phone:'13900000000'},pickupContact:{phone:'13900000000'},lines:[]});
 const filtered=await h.main({action:'adminOrderPage',deliveryMode:'pickup',keyword:'13900000000',limit:5});assert.equal(filtered.ok,true);assert.equal(filtered.data.orders.length,5);assert.ok(filtered.data.orders.every(o=>o.deliveryMode==='pickup'));assert.equal(filtered.data.hasMore,true);
 const next=await h.main({action:'adminOrderPage',deliveryMode:'pickup',keyword:'13900000000',cursor:filtered.data.nextCursor,limit:5});assert.equal(next.data.orders.length,5);assert.ok(next.data.orders.every(o=>!filtered.data.orders.some(x=>x.id===o.id)));
 assert.equal((await h.main({action:'adminOrderPage',keyword:'.*'})).data.orders.length,0);
 h.as('buyer');assert.equal((await h.main({action:'adminOrderPage',keyword:'13900000000'})).ok,false);
});
test('business day follows China time and excludes test, unpaid and unverified orders from paid money',()=>{
 const now=Date.parse('2026-10-14T15:00:00Z'),{start,end}=analytics.localDay(now);assert.equal(start,Date.parse('2026-10-13T16:00:00Z'));assert.equal(end,Date.parse('2026-10-14T16:00:00Z'));
 const order={transactionId:'verified',paidAt:start,total:100,status:'paid'};
 const r=analytics.paidSummary([order,{...order,kind:'payment_test'},{...order,status:'pending'},{...order,transactionId:''},{...order,paidAt:end},{...order,total:200,status:'refunded',refundedAt:start,refundAmountCents:200},{...order,total:300,status:'refunded',refundedAt:start}],now);
 assert.equal(r.paidCents,600);assert.equal(r.paidCount,3);assert.equal(r.refundedCents,200);assert.equal(r.unknownRefunds,1);
});
test('merchant overview counts pending delivery, preparation and pickup without mixing test orders',async()=>{
 const h=harness(),now=Date.now();const fixtures=[{id:'A',status:'paid',deliveryMode:'delivery',paidAt:now,total:100,transactionId:'verified'},{id:'B',status:'paid',deliveryMode:'pickup',paidAt:now,total:200,transactionId:'verified2'},{id:'C',status:'ready_pickup',total:300},{id:'T',kind:'payment_test',status:'paid',paidAt:now,total:1,transactionId:'test'}];for(const f of fixtures)h.collections.orders.set(f.id,{...f,_id:f.id});
 const r=await h.main({action:'merchantOverview'});assert.equal(r.ok,true);assert.equal(r.data.paidCents,300);assert.equal(r.data.deliveryToShip,1);assert.equal(r.data.pickupToPrepare,1);assert.equal(r.data.pickupReady,1);h.as('visitor');assert.equal((await h.main({action:'merchantOverview'})).ok,false);
});
test('stock history preserves the before values and reveals no administrator identifiers',async()=>{
 const h=harness();const r=await h.main({action:'updateProduct',id:'TESTPRODUCT',token:'stock-history-change',patch:{skuId:'TESTSKU',priceCents:1200,stockDelta:2,active:true}});assert.equal(r.ok,true);
 const history=await h.main({action:'inventoryHistory',id:'TESTPRODUCT'});assert.equal(history.ok,true);assert.equal(history.data[0].before.stock,8);assert.equal(history.data[0].before.priceCents,1000);assert.equal(history.data[0].stockDelta,2);assert.equal(history.data[0].priceCents,1200);assert.equal(history.data[0].operator,'当前账号');assert.ok(!JSON.stringify(history.data).includes('_openid'));
});
test('exports preserve cents and string contacts, escape formulas and never mutate inventory',async()=>{
 const h=harness();const p=h.collections.products.get('TESTPRODUCT');p.name='=untrusted formula';p.skus[0].name='默认款';p.skus[0].price=1230;
 const exported=await h.main({action:'exportMerchantData',kind:'products'});assert.equal(exported.ok,true);assert.ok(exported.data.bytes<600*1024);const book=new ExcelJS.Workbook();await book.xlsx.load(Buffer.from(exported.data.base64,'base64'));const row=book.worksheets[0].getRow(2);assert.equal(row.getCell(2).value,"'=untrusted formula");assert.equal(row.getCell(5).value,12.3);assert.equal(row.getCell(6).value,8);assert.equal(h.collections.products.get('TESTPRODUCT').skus[0].stock,8);
 h.as('visitor');assert.equal((await h.main({action:'exportMerchantData',kind:'products'})).ok,false);
});
test('private backup keeps order date boundaries and omits product creation fingerprints',async()=>{
 const h=harness();h.collections.products.get('TESTPRODUCT')._createdBy='secret-administrator';h.collections.products.get('TESTPRODUCT')._creationSignature='internal';
 for(const [id,time] of [['before','2026-10-13T15:59:59Z'],['inside','2026-10-13T16:00:00Z'],['after','2026-10-14T16:00:00Z']])h.collections.orders.set(id,{_id:id,id,createdAt:Date.parse(time),lines:[]});
 const r=await h.main({action:'exportMerchantData',kind:'backup',from:'2026-10-14',to:'2026-10-14'});assert.equal(r.ok,true);assert.equal(r.data.orders,1);const zip=await JSZip.loadAsync(Buffer.from(r.data.base64,'base64'));const products=await zip.file('products.json').async('string');assert.ok(!products.includes('secret-administrator'));assert.ok(!products.includes('_creationSignature'));const orders=JSON.parse(await zip.file('orders.json').async('string'));assert.equal(orders[0].id,'inside');assert.throws(()=>ops.dateRange('2026-02-30','2026-03-01'));assert.throws(()=>ops.dateRange('2026-01-01','2026-03-01'));
});
