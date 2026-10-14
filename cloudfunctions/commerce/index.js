const cloud=require('wx-server-sdk'),crypto=require('crypto'),domain=require('./domain'),pay=require('./pay'),inventory=require('./inventory'),business=require('./business'),consent=require('./consent-version'),paymentTest=require('./payment-test');
const VERSION='0.1.5';
const orderShipping=require('./order-shipping'),maintenance=require('./maintenance');
const authorization=require('./authorization');
const shopSettings=require('./shop-settings');
const productManagement=require('./product-management');
function runtimeInfo(){let paymentConfigured=false;try{pay.config();paymentConfigured=true}catch(e){}return {version:VERSION,checkoutEnabled:process.env.ENABLE_CHECKOUT==='true',paymentConfigured,paymentTestEnabled:process.env.ENABLE_PAYMENT_TEST==='true',adminConfigured:authorization.resolveAdminOpenIds(process.env).length>0,orderShippingEnabled:orderShipping.enabled(),automaticExpiryConfigured:!!process.env.ORDER_MAINTENANCE_TOKEN,automaticExpiryEnabled:process.env.ORDER_EXPIRY_TIMER_ENABLED==='true'}}
function viewOrder(o,openid){const owner=o._openid===openid;return {...o,canPay:owner&&o.status==='pending'&&o.expiresAt>Date.now()&&(paymentTest.isTest(o)?process.env.ENABLE_PAYMENT_TEST==='true':process.env.ENABLE_CHECKOUT==='true'),canCancel:owner&&o.status==='pending',canReceive:owner&&o.status==='shipped'&&!paymentTest.isTest(o),viewAsAdmin:!owner,usesWechatReceipt:orderShipping.enabled()&&!paymentTest.isTest(o)}}
cloud.init({env:cloud.DYNAMIC_CURRENT_ENV});const db=cloud.database();
async function shippingPolicy(){
 const raw=process.env.SHIPPING_FEE_CENTS,fee=raw===undefined||raw===''?business.shippingFee:Number(raw);
 if(fee!==null&&(!Number.isSafeInteger(fee)||fee<0))throw new Error('正式运费配置无效');
 const settings=await shopSettings.read(db);
 return {...business,...settings,shippingFee:fee,pickupLocation:(process.env.PICKUP_LOCATION||'').trim(),pickupHours:(process.env.PICKUP_HOURS||'').trim()};
}
const fail=m=>{throw new Error(m)};
const isAdmin=openid=>authorization.isAdmin(openid,process.env);
async function readOrder(id,openid,admin=false){if(typeof id!=='string'||!/^[a-zA-Z0-9_-]{6,40}$/.test(id))fail('订单编号无效');const {data:o}=await db.collection('orders').doc(id).get();if(!o||o._openid!==openid&&!(admin&&isAdmin(openid)))fail('无权查看此订单');return o}
async function update(id,check,change){return db.runTransaction(async tx=>{const ref=tx.collection('orders').doc(id),{data:o}=await ref.get();if(!check(o))fail('订单状态已变更，请刷新');await ref.update({data:change});return {...o,...change}})}
async function paid(result){const c=pay.config();if(result.trade_state!=='SUCCESS')return;if(result.appid!==c.WX_APPID||result.mchid!==c.WX_MCHID)fail('支付商户不匹配');return db.runTransaction(async tx=>{const ref=tx.collection('orders').doc(result.out_trade_no),{data:o}=await ref.get();if(!o||o.total!==result.amount.total||result.amount.currency!=='CNY'||o._openid!==result.payer.openid)fail('支付金额或用户不匹配');if(o.status==='paid'||['shipped','ready_pickup','completed','refund_requested','refunded'].includes(o.status))return o;if(o.status!=='pending')fail('异常支付状态，需商家核对');await ref.update({data:{status:'paid',transactionId:result.transaction_id,paidAt:Date.now(),lock:'',lockAt:0}});return {...o,status:'paid'}})}
async function sync(id){try{const r=await pay.query(id);await paid(r);return r}catch(e){if(e.code==='ORDER_NOT_EXIST')return {trade_state:'ORDER_NOT_EXIST'};throw e}}
async function cancel(o){await update(o.id,x=>x.status==='pending'&&!x.lock,{lock:'close',lockAt:Date.now()});try{const r=await sync(o.id);if(r.trade_state==='SUCCESS')fail('订单已付款，不能取消');if(r.trade_state==='NOTPAY')await pay.close(o.id);else if(!['CLOSED','ORDER_NOT_EXIST','PAYERROR','REVOKED'].includes(r.trade_state))fail('支付状态尚未确定，请稍后重试');return await db.runTransaction(async tx=>{const ref=tx.collection('orders').doc(o.id),{data:current}=await ref.get();if(current.status!=='pending'||current.lock!=='close')fail('订单状态已变更');if(!paymentTest.isTest(current))for(const pid of [...new Set(current.lines.map(l=>l.productId))]){const pref=tx.collection('products').doc(pid),{data:p}=await pref.get();for(const l of current.lines.filter(l=>l.productId===pid)){const sku=p.skus.find(s=>s.id===l.skuId);if(!sku)fail('商品款式已变更，需人工处理');sku.stock+=l.qty}await pref.update({data:{skus:p.skus}})}await ref.update({data:{status:'cancelled',lock:'',cancelledAt:Date.now()}});return {...current,status:'cancelled'}})}catch(e){await db.runTransaction(async tx=>{const ref=tx.collection('orders').doc(o.id),{data:x}=await ref.get();if(x.status==='pending'&&x.lock==='close')await ref.update({data:{lock:'',lockAt:0}})});throw e}}
async function catalog(admin=false,resolve=true){let items=[],offset=0;while(true){const r=await db.collection('products').where(admin?{}:{active:true}).skip(offset).limit(100).get();items.push(...r.data);if(r.data.length<100)break;offset+=100;if(offset>5000)break}return resolve?productManagement.resolveImages(cloud,items.map(p=>({...p,id:p._id}))):items.map(p=>({...p,id:p._id}))}
async function orderImages(orders){const lines=orders.flatMap(o=>o.lines||[]);if(!lines.some(l=>typeof l.image==='string'&&l.image.startsWith('cloud://')))return orders;const resolved=await productManagement.resolveImages(cloud,lines);let offset=0;return orders.map(o=>({...o,lines:(o.lines||[]).map(()=>resolved[offset++])}))}
exports.main=async(event)=>{
 // HTTP endpoints accept verified WeChat Pay callbacks only. No HTTP commerce/admin API.
 if(event.httpMethod){try{if(event.httpMethod!=='POST')return {statusCode:405,body:''};await paid(pay.decode(event));return {statusCode:204,body:''}}catch(e){console.error('payment_callback_failed');return {statusCode:400,body:JSON.stringify({code:'FAIL',message:'回调校验或订单处理失败'})}}}
 const wxContext=cloud.getWXContext();
 if(maintenance.validTimer(event,wxContext))return {ok:true,data:await maintenance.expire(db,cancel,sync)};
 const {OPENID:openid}=wxContext;if(!openid)return {ok:false,message:'请通过微信小程序调用'};
 try{
  const a=event.action;
  if(productManagement.ACTIONS.has(a)){if(!isAdmin(openid))fail('仅商家管理员可管理商品');return {ok:true,data:await productManagement.run({db,cloud,openid,envId:wxContext.ENV||process.env.TCB_ENV},event)}}
  if(a==='shippingPolicy')return {ok:true,data:await shippingPolicy()};
  if(a==='adminPromotion'){if(!isAdmin(openid))fail('仅商家管理员可查看活动设置');return {ok:true,data:await shippingPolicy()}}
  if(a==='setPromotion'){if(!isAdmin(openid))fail('仅商家管理员可修改活动');return {ok:true,data:await shopSettings.save(db,event.discount)}}
  if(a==='catalog')return {ok:true,data:await catalog()};

  if(a==='adminProducts'){if(!isAdmin(openid))fail('仅商家管理员可访问');return {ok:true,data:await catalog(true)}}
  if(a==='updateProduct'){
   if(!isAdmin(openid))fail('仅商家管理员可修改商品');
   if(typeof event.id!=='string'||!/^[a-zA-Z0-9_-]{1,60}$/.test(event.id)||typeof event.token!=='string'||!/^[a-zA-Z0-9_-]{8,80}$/.test(event.token))fail('保存标识无效');
   const opId=crypto.createHash('sha256').update(openid+':'+event.token).digest('hex'),signature=JSON.stringify({id:event.id,patch:event.patch});
   const product=await db.runTransaction(async tx=>{
    const log=tx.collection('inventory_changes').doc(opId);let old;try{old=(await log.get()).data}catch(e){if(!/not exist|not found|不存在/i.test(e.message||''))throw e}
    if(old){if(old.signature!==signature)fail('保存标识已用于其他修改');return old.product}
    const ref=tx.collection('products').doc(event.id),{data:p}=await ref.get();if(p._createdBy && event.patch && event.patch.active && (!p.image||p.image.includes('placeholder.jpg')))fail('请先补充商品图片再上架');const updated=inventory.patchProduct(p,event.patch);
    await ref.update({data:{skus:updated.skus,active:updated.active,needsReview:updated.needsReview,updatedAt:updated.updatedAt}});
    const result=productManagement.publicProduct({...updated,id:event.id});await log.set({data:{_openid:openid,productId:event.id,signature,product:result,createdAt:Date.now()}});return result;
   });return {ok:true,data:product};
  }
  if(a==='orderPage'){
   const offset=event.offset===undefined?0:event.offset,limit=event.limit===undefined?20:event.limit,status=event.status||'all';
   if(!Number.isInteger(offset)||offset<0||offset>100000||!Number.isInteger(limit)||limit<1||limit>50||!['all','pending','paid','shipped','completed','cancelled','ready_pickup','refund_requested','refunded'].includes(status))fail('分页参数无效');
   const query={_openid:openid};if(status!=='all')query.status=status==='refund_requested'?db.command.in(['refund_requested','refunded']):status;
   const {data:rows}=await db.collection('orders').where(query).orderBy('createdAt','desc').orderBy('_id','desc').skip(offset).limit(limit+1).get();
   return {ok:true,data:{orders:await orderImages(rows.slice(0,limit)),hasMore:rows.length>limit,nextOffset:offset+limit}};
  }
  if(a==='whoami')return {ok:true,data:{openid,isAdmin:isAdmin(openid)}};
  if(a==='runtime'){if(!isAdmin(openid))fail('仅商家管理员可访问');return {ok:true,data:runtimeInfo()}}
  if(a==='orderShippingStatus'){if(!isAdmin(openid))fail('仅商家管理员可访问');return {ok:true,data:await orderShipping.status(cloud,process.env.WX_APPID)}}
  if(a==='shippingCarriers'){if(!isAdmin(openid))fail('仅商家管理员可访问');return {ok:true,data:orderShipping.CARRIERS}}
  if(a==='adminOrderPage'){
   if(!isAdmin(openid))fail('仅商家管理员可访问');
   const offset=event.offset===undefined?0:event.offset,limit=event.limit===undefined?20:event.limit,status=event.status||'all';
   if(!Number.isInteger(offset)||offset<0||offset>100000||!Number.isInteger(limit)||limit<1||limit>50||!['all','pending','paid','shipped','completed','cancelled','ready_pickup','refund_requested','refunded'].includes(status))fail('分页参数无效');
   let where={};if(status!=='all')where.status=status==='refund_requested'?db.command.in(['refund_requested','refunded']):status;
   const cursor=event.cursor;
   if(cursor!==undefined&&cursor!==null){
    if(typeof cursor!=='object'||!Number.isSafeInteger(cursor.createdAt)||cursor.createdAt<0||typeof cursor.id!=='string'||!/^[a-zA-Z0-9_-]{6,40}$/.test(cursor.id))fail('分页游标无效');
    where=db.command.and([where,db.command.or([{createdAt:db.command.lt(cursor.createdAt)},{createdAt:cursor.createdAt,_id:db.command.lt(cursor.id)}])]);
   }
   const {data:rows}=await db.collection('orders').where(where).orderBy('createdAt','desc').orderBy('_id','desc').skip(cursor?0:offset).limit(limit+1).get();
   const orders=rows.slice(0,limit),last=orders[orders.length-1];
   return {ok:true,data:{orders:await orderImages(orders),hasMore:rows.length>limit,nextOffset:offset+limit,nextCursor:last?{createdAt:last.createdAt,id:last._id||last.id}:null}};
  }
  if(a==='createPaymentTestOrder'){
   if(!isAdmin(openid))fail('仅商家管理员可创建支付测试订单');
   if(process.env.ENABLE_PAYMENT_TEST!=='true')fail('支付测试暂未开放');
   const privacyConsent=consent.validateConsent(event.privacyConsent);pay.config();
   const id=paymentTest.orderId(openid,event.token);
   const data=await db.runTransaction(async tx=>{
    const ref=tx.collection('orders').doc(id);let old;try{old=(await ref.get()).data}catch(e){if(!/not exist|not found|不存在/i.test(e.message||''))throw e}
    if(old){if(old._openid!==openid||!paymentTest.isTest(old))fail('测试订单标识冲突');return old}
    const order=paymentTest.build(openid,event.token,privacyConsent,Date.now());await ref.set({data:order});return order;
   });return {ok:true,data};
  }
  if(a==='createOrder'){
   const privacyConsent=consent.validateConsent(event.privacyConsent);
   if(process.env.ENABLE_CHECKOUT!=='true')fail('商城尚未开放正式交易');pay.config();const policy=await shippingPolicy(),fulfillment=domain.validateFulfillment(event,event.address,policy,true);if(typeof event.token!=='string'||!/^[a-zA-Z0-9_-]{8,80}$/.test(event.token))fail('下单标识无效');
   const id='G'+crypto.createHash('sha256').update(openid+':'+event.token).digest('hex').slice(0,28);
   const data=await db.runTransaction(async tx=>{const ref=tx.collection('orders').doc(id);let existing;try{existing=(await ref.get()).data}catch(e){if(!/not exist|not found|不存在/i.test(e.message||''))throw e}if(existing)return existing;const all=await catalog(false,false);const ids=[...new Set((event.items||[]).map(i=>{const p=all.find(p=>p.skus.some(s=>s.id===i.skuId));if(!p)fail('商品不存在');return p.id}))];const products=[];for(const pid of ids){const p=(await tx.collection('products').doc(pid).get()).data;if(p.needsReview)fail(p.name+'尚未核对售卖资料');products.push({...p,id:pid})}const q=domain.quote(products,event.items,policy,fulfillment);if(q.shippingError)fail(q.shippingError);if(event.promotionRevision!==undefined && event.promotionRevision!==policy.revision || event.promotionRevision===undefined && policy.revision>0)fail('折扣已更新，请刷新核对金额后再下单');if(event.expectedTotal!==undefined && event.expectedTotal!==q.total)fail('商品金额已变更，请刷新核对后再下单');for(const p of products){q.lines.filter(l=>l.productId===p.id).forEach(l=>p.skus.find(s=>s.id===l.skuId).stock-=l.qty);await tx.collection('products').doc(p.id).update({data:{skus:p.skus}})}const order={id,_openid:openid,token:event.token,...q,...fulfillment,privacyConsent,status:'pending',lock:'',demo:false,createdAt:Date.now(),expiresAt:Date.now()+15*60*1000};await ref.set({data:order});return order});return {ok:true,data};
  }
  if(a==='orders')return {ok:true,data:await orderImages((await db.collection('orders').where({_openid:openid}).orderBy('createdAt','desc').limit(100).get()).data)};
  if(a==='adminOrders'){if(!isAdmin(openid))fail('仅商家管理员可访问');return {ok:true,data:await orderImages((await db.collection('orders').orderBy('createdAt','desc').limit(100).get()).data)}}
  if(a==='expireOrders'){if(!isAdmin(openid))fail('仅商家管理员可访问');const data=await maintenance.expire(db,cancel,sync);return {ok:true,data:{...data,count:data.cancelled}}}
  const o=await readOrder(event.id,openid,['ship','order','syncPayment','syncShipping','preparePickup','completePickup'].includes(a));
  if(a==='order'){if(o.status==='pending'&&o.expiresAt<=Date.now()&&!o.lock){try{await cancel(o)}catch(e){}}return {ok:true,data:viewOrder((await orderImages([await readOrder(o.id,openid,true)]))[0],openid)}};
  if(paymentTest.isTest(o)&&['ship','syncShipping','preparePickup','completePickup','receive','refund'].includes(a))fail('支付测试订单不发货、不核销；退款请在商户平台处理');
  if(a==='syncPayment'){if(o.status==='pending')await sync(o.id);return {ok:true,data:viewOrder((await orderImages([await readOrder(o.id,openid,true)]))[0],openid)}};
  if(a==='pay'){if(paymentTest.isTest(o)){if(!isAdmin(openid)||process.env.ENABLE_PAYMENT_TEST!=='true')fail('支付测试暂未开放')}else if(process.env.ENABLE_CHECKOUT!=='true')fail('商城尚未开放正式交易');if(o.expiresAt<=Date.now())fail('订单已超过付款时间，请取消后重新下单');await update(o.id,x=>x.status==='pending'&&!x.lock,{lock:'pay',lockAt:Date.now()});try{return {ok:true,data:await pay.create(o)}}finally{await db.runTransaction(async tx=>{const ref=tx.collection('orders').doc(o.id),{data:x}=await ref.get();if(x.status==='pending'&&x.lock==='pay')await ref.update({data:{lock:'',lockAt:0}})})}}
  if(a==='cancel')return {ok:true,data:await cancel(o)};
  if(a==='syncShipping'){if(!isAdmin(openid))fail('仅商家管理员可同步发货');if(!orderShipping.enabled())fail('微信发货同步尚未开启');if(!['shipped','completed'].includes(o.status))fail('当前订单尚未实际交付');const r=await orderShipping.upload(cloud,o);return {ok:true,data:await update(o.id,x=>['shipped','completed'].includes(x.status),{wechatShippingSynced:r.synced,wechatShippingSyncedAt:Date.now(),wechatShippingError:''})}}
  if(a==='receive'){
   if(orderShipping.enabled()){const r=await orderShipping.get(cloud,o);if(!orderShipping.matches(o,r)||![3,4].includes(r.order.order_state))fail('请先通过微信确认收货，再刷新订单状态')}
   return {ok:true,data:await update(o.id,x=>x._openid===openid&&x.status==='shipped',{status:'completed',receivedAt:Date.now()})};
  }
  if(a==='refund'){if(typeof event.reason!=='string'||event.reason.trim().length<3||event.reason.length>300)fail('请填写售后原因');return {ok:true,data:await update(o.id,x=>x._openid===openid&&['paid','shipped','ready_pickup','completed'].includes(x.status),{status:'refund_requested',refundReason:event.reason.trim(),refundAt:Date.now()})}}
  if(a==='preparePickup'){
   if(!isAdmin(openid))fail('仅商家管理员可备货');
   const ready=await update(o.id,x=>x.status==='paid'&&x.deliveryMode==='pickup',{status:'ready_pickup',pickupCode:String(crypto.randomInt(100000,1000000)),readyAt:Date.now(),wechatShippingSynced:false});return {ok:true,data:ready};
  }
  if(a==='completePickup'){
   if(!isAdmin(openid))fail('仅商家管理员可核销');if(typeof event.pickupCode!=='string'||!/^\d{6}$/.test(event.pickupCode))fail('请填写6位自取码');
   const current=await update(o.id,x=>x.status==='ready_pickup'&&x.deliveryMode==='pickup'&&x.pickupCode===event.pickupCode,{status:'completed',receivedAt:Date.now(),shippedAt:Date.now(),wechatShippingSynced:false});
   if(orderShipping.enabled()){try{await orderShipping.upload(cloud,current);await update(o.id,x=>x.status==='completed',{wechatShippingSynced:true,wechatShippingSyncedAt:Date.now(),wechatShippingError:''})}catch(e){await update(o.id,x=>x.status==='completed',{wechatShippingError:'微信发货未同步，请重试'});}}
   return {ok:true,data:await readOrder(o.id,openid,true)};
  }
  if(a==='ship'){
   if(!isAdmin(openid))fail('仅商家管理员可发货');if(typeof event.carrier!=='string'||typeof event.tracking!=='string'||!event.carrier.trim()||event.carrier.length>40||!/^[a-zA-Z0-9-]{5,40}$/.test(event.tracking))fail('请填写有效快递公司与单号');
   if(orderShipping.enabled()&&(typeof event.carrierCode!=='string'||!/^[a-zA-Z0-9()_-]{1,40}$/.test(event.carrierCode)))fail('请选择快递公司');
   const shipped=await update(o.id,x=>x.status==='paid'&&x.deliveryMode!=='pickup',{status:'shipped',carrier:event.carrier.trim(),carrierCode:event.carrierCode||'',tracking:event.tracking,shippedAt:Date.now(),wechatShippingSynced:false});
   if(orderShipping.enabled()){try{await orderShipping.upload(cloud,shipped);await update(o.id,x=>x.status==='shipped',{wechatShippingSynced:true,wechatShippingSyncedAt:Date.now(),wechatShippingError:''})}catch(e){await update(o.id,x=>x.status==='shipped',{wechatShippingError:'微信发货未同步，请重试'});}}
   return {ok:true,data:await readOrder(o.id,openid,true)};
  }
  fail('不支持的操作');
 }catch(e){return {ok:false,message:e.message||'服务暂不可用'}}
};
