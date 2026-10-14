const {DAY,OFFSET,localDay,paidSummary}=require('./shop-analytics');
const ACTIONS=new Set(['merchantOverview','inventoryHistory','exportMerchantData']);
function orderFilter(db,status='all',deliveryMode='all',keyword='') {
 if(!['all','delivery','pickup'].includes(deliveryMode))throw new Error('配送筛选无效');
 if(typeof keyword!=='string'||keyword.length>60||/[\x00-\x1f]/.test(keyword))throw new Error('搜索内容无效');
 const _=db.command, clauses=[];
 if(status!=='all')clauses.push({status:status==='refund_requested'?_.in(['refund_requested','refunded']):status});
 if(deliveryMode==='pickup')clauses.push({deliveryMode:'pickup'});
 if(deliveryMode==='delivery')clauses.push({deliveryMode:_.neq('pickup'),kind:_.neq('payment_test')});
 const text=keyword.trim();if(text){const regex=db.RegExp({regexp:text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),options:'i'});clauses.push(_.or([{id:regex},{'address.phone':regex},{'pickupContact.phone':regex}]));}
 return clauses.length===0?{}:clauses.length===1?clauses[0]:_.and(clauses);
}
async function collect(db,name,where={},limit=2000,fields) {
 const rows=[],deadline=Date.now()+10000;
 for(let offset=0;;offset+=100){let query=db.collection(name).where(where).orderBy('_id','asc').skip(offset).limit(100);if(fields)query=query.field(fields);
  const response=await query.get();rows.push(...response.data);if(rows.length>limit)throw new Error('数据较多，请缩短导出日期范围后再试');if(response.data.length<100)return rows;if(Date.now()>deadline)throw new Error('数据读取较慢，请稍后重试或缩短日期范围');
 }
}
function dateRange(from,to){
 const date=v=>{if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v))throw new Error('请选择有效日期');const n=Date.parse(v+'T00:00:00+08:00');if(!Number.isFinite(n)||new Date(n+OFFSET).toISOString().slice(0,10)!==v)throw new Error('日期无效');return n};
 const start=date(from),end=date(to)+DAY;if(end<=start||end-start>31*DAY)throw new Error('每次请选择1至31天的订单');return {start,end};
}
function escapeSpreadsheet(value){const s=String(value===undefined||value===null?'':value);return /^[\s]*[=+@-]/.test(s)?"'"+s:s;}
function publicBackupProduct(p){const {_createdBy,_creationSignature,...clean}=p;return clean;}
async function exportData({db,cloud,openid},event){
 if(!['products','orders','backup'].includes(event.kind))throw new Error('导出类型无效');
 let products=[],orders=[];if(event.kind!=='orders')products=(await collect(db,'products',{},5000)).map(publicBackupProduct);
 if(event.kind!=='products'){const {start,end}=dateRange(event.from,event.to),_=db.command;orders=await collect(db,'orders',_.and([{createdAt:_.gte(start)},{createdAt:_.lt(end)}]),2000);}
 let buffer,filename,fileType;
 if(event.kind==='backup'){
  const JSZip=require('jszip'),zip=new JSZip();zip.file('products.json',JSON.stringify(products,null,2));zip.file('orders.json',JSON.stringify(orders,null,2));zip.file('settings.json',JSON.stringify(await require('./shop-settings').read(db),null,2));
  zip.file('说明.txt','商品资料和库存为导出时的快照；订单日期范围：'+event.from+'至'+event.to+'。图片文件本体不包含在此备份中，仅保留图片引用。此文件包含本店经营数据及所选订单的收货信息。');
  buffer=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});filename='店铺数据备份-'+event.from+'-'+event.to+'.zip';fileType='zip';
 }else{
  const ExcelJS=require('exceljs'),book=new ExcelJS.Workbook(),sheet=book.addWorksheet(event.kind==='products'?'商品库存':'订单');
  if(event.kind==='products'){
   sheet.addRow(['商品编号','商品名称','款式编号','款式','零售价','数量','商品分组','商品类型','IP','状态','商品介绍']);
   for(const p of products)for(const sku of p.skus||[])sheet.addRow([p.id||p._id,p.name,sku.id,sku.name,sku.price/100,sku.stock,p.group,p.type,p.ip,p.active?'在售':'已下架',p.description].map((v,i)=>[4,5].includes(i)?v:escapeSpreadsheet(v)));
  }else{
   sheet.addRow(['订单号','下单时间','订单状态','配送方式','订单金额','支付时间','联系人','联系电话','收货地址','商品明细','快递公司','快递单号']);
   const time=n=>n?new Date(n+OFFSET).toISOString().replace('T',' ').slice(0,19):'';
   for(const o of orders){const c=(o.deliveryMode==='pickup'?o.pickupContact:o.address)||{};sheet.addRow([o.id,time(o.createdAt),o.status,o.kind==='payment_test'?'支付测试':o.deliveryMode==='pickup'?'自取':'快递',o.total/100,time(o.paidAt),c.name,c.phone,o.address?[...(o.address.region||[]),o.address.detail].join(''):'',(o.lines||[]).map(l=>l.name+' '+l.skuName+' ×'+l.qty).join('；'),o.carrier,o.tracking].map((v,i)=>i===4?v:escapeSpreadsheet(v)));}
  }
  sheet.getRow(1).font={bold:true};sheet.columns.forEach(c=>c.width=22);buffer=Buffer.from(await book.xlsx.writeBuffer());fileType='xlsx';filename=event.kind==='products'?'商品库存.xlsx':'订单-'+event.from+'-'+event.to+'.xlsx';
 }
 if(buffer.length>600*1024)throw new Error('导出文件较大，请缩短日期范围或分开导出商品与订单');
 // The private file is sent to the authorized device, never stored in a public bucket.
 return {filename,fileType,base64:buffer.toString('base64'),bytes:buffer.length,products:products.length,orders:orders.length};
}
async function run(ctx,event){
 const {db,openid}=ctx,_=db.command;
 if(event.action==='exportMerchantData')return exportData(ctx,event);
 if(event.action==='inventoryHistory'){
  if(typeof event.id!=='string'||!/^[A-Za-z0-9_-]{1,60}$/.test(event.id))throw new Error('商品编号无效');
  const {data}=await db.collection('inventory_changes').where({productId:event.id}).orderBy('createdAt','desc').limit(30).get();
  return data.map(row=>{let patch={};try{patch=JSON.parse(row.signature||'{}').patch||{}}catch(_){}const sku=row.product&&(row.product.skus||[]).find(x=>x.id===patch.skuId);return {createdAt:row.createdAt,operator:row._openid===openid?'当前账号':'其他管理员',skuName:sku&&sku.name||'',stockDelta:patch.stockDelta,priceCents:sku&&sku.price,active:row.product&&row.product.active,before:row.before||null};});
 }
 if(event.action==='merchantOverview'){
  const {start,end}=localDay(),count=where=>db.collection('orders').where(_.and([{kind:_.neq('payment_test')},where])).count().then(r=>r.total);
  const records=await collect(db,'orders',_.or([_.and([{paidAt:_.gte(start)},{paidAt:_.lt(end)}]),_.and([{refundedAt:_.gte(start)},{refundedAt:_.lt(end)}])]),5000,{status:true,kind:true,paidAt:true,refundedAt:true,total:true,refundAmountCents:true,transactionId:true});
  const [deliveryToShip,pickupToPrepare,pickupReady,refundRequests,shippingUnsynced]=await Promise.all([count({status:'paid',deliveryMode:_.neq('pickup')}),count({status:'paid',deliveryMode:'pickup'}),count({status:'ready_pickup'}),count({status:'refund_requested'}),count({status:_.in(['shipped','completed']),wechatShippingSynced:false})]);
  return {...paidSummary(records),deliveryToShip,pickupToPrepare,pickupReady,refundRequests,shippingUnsynced};
 }
 throw new Error('不支持的管理操作');
}
module.exports={ACTIONS,orderFilter,localDay,paidSummary,dateRange,escapeSpreadsheet,collect,run};
