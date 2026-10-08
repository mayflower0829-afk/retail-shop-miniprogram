const cloud=require('wx-server-sdk'),crypto=require('crypto'),domain=require('./domain'),pay=require('./pay'),inventory=require('./inventory'),business=require('./business'),consent=require('./consent-version');
cloud.init({env:cloud.DYNAMIC_CURRENT_ENV});const db=cloud.database();
function shippingPolicy(){
 const raw=process.env.SHIPPING_FEE_CENTS,fee=raw===undefined||raw===''?business.shippingFee:Number(raw);
 if(fee!==null&&(!Number.isSafeInteger(fee)||fee<0))throw new Error('正式运费配置无效');
 return {...business,shippingFee:fee,pickupLocation:(process.env.PICKUP_LOCATION||'').trim(),pickupHours:(process.env.PICKUP_HOURS||'').trim()};
}
const fail=m=>{throw new Error(m)};
const isAdmin=openid=>(process.env.ADMIN_OPENIDS||'').split(',').map(x=>x.trim()).includes(openid);
async function readOrder(id,openid,admin=false){if(typeof id!=='string'||!/^[a-zA-Z0-9_-]{6,40}$/.test(id))fail('订单编号无效');const {data:o}=await db.collection('orders').doc(id).get();if(!o||o._openid!==openid&&!(admin&&isAdmin(openid)))fail('无权查看此订单');return o}
async function update(id,check,change){return db.runTransaction(async tx=>{const ref=tx.collection('orders').doc(id),{data:o}=await ref.get();if(!check(o))fail('订单状态已变更，请刷新');await ref.update({data:change});return {...o,...change}})}
async function paid(result){const c=pay.config();if(result.trade_state!=='SUCCESS')return;if(result.appid!==c.WX_APPID||result.mchid!==c.WX_MCHID)fail('支付商户不匹配');return db.runTransaction(async tx=>{const ref=tx.collection('orders').doc(result.out_trade_no),{data:o}=await ref.get();if(!o||o.total!==result.amount.total||result.amount.currency!=='CNY'||o._openid!==result.payer.openid)fail('支付金额或用户不匹配');if(o.status==='paid'||['shipped','ready_pickup','completed','refund_requested','refunded'].includes(o.status))return o;if(o.status!=='pending')fail('异常支付状态，需商家核对');await ref.update({data:{status:'paid',transactionId:result.transaction_id,paidAt:Date.now(),lock:''}});return {...o,status:'paid'}})}
async function sync(id){try{const r=await pay.query(id);await paid(r);return r}catch(e){if(e.code==='ORDER_NOT_EXIST')return {trade_state:'ORDER_NOT_EXIST'};throw e}}
async function cancel(o){await update(o.id,x=>x.status==='pending'&&!x.lock,{lock:'close'});try{const r=await sync(o.id);if(r.trade_state==='SUCCESS')fail('订单已付款，不能取消');if(r.trade_state==='NOTPAY')await pay.close(o.id);else if(!['CLOSED','ORDER_NOT_EXIST','PAYERROR','REVOKED'].includes(r.trade_state))fail('支付状态尚未确定，请稍后重试');return await db.runTransaction(async tx=>{const ref=tx.collection('orders').doc(o.id),{data:current}=await ref.get();if(current.status!=='pending'||current.lock!=='close')fail('订单状态已变更');for(const pid of [...new Set(current.lines.map(l=>l.productId))]){const pref=tx.collection('products').doc(pid),{data:p}=await pref.get();for(const l of current.lines.filter(l=>l.productId===pid)){const sku=p.skus.find(s=>s.id===l.skuId);if(!sku)fail('商品款式已变更，需人工处理');sku.stock+=l.qty}await pref.update({data:{skus:p.skus}})}await ref.update({data:{status:'cancelled',lock:'',cancelledAt:Date.now()}});return {...current,status:'cancelled'}})}catch(e){await db.runTransaction(async tx=>{const ref=tx.collection('orders').doc(o.id),{data:x}=await ref.get();if(x.status==='pending'&&x.lock==='close')await ref.update({data:{lock:''}})});throw e}}
async function catalog(admin=false){let items=[],offset=0;while(true){const r=await db.collection('products').where(admin?{}:{active:true}).skip(offset).limit(100).get();items.push(...r.data);if(r.data.length<100)break;offset+=100;if(offset>5000)break}return items.map(p=>({...p,id:p._id}))}
exports.main=async(event)=>{
 // HTTP endpoints accept verified WeChat Pay callbacks only. No HTTP commerce/admin API.
 if(event.httpMethod){try{if(event.httpMethod!=='POST')return {statusCode:405,body:''};await paid(pay.decode(event));return {statusCode:204,body:''}}catch(e){console.error('payment_callback_failed');return {statusCode:400,body:JSON.stringify({code:'FAIL',message:'回调校验或订单处理失败'})}}}
 const {OPENID:openid}=cloud.getWXContext();if(!openid)return {ok:false,message:'请通过微信小程序调用'};
 try{
  const a=event.action;
  if(a==='shippingPolicy')return {ok:true,data:shippingPolicy()};
  if(a==='catalog')return {ok:true,data:await catalog()};

  if(a==='adminProducts'){if(!isAdmin(openid))fail('仅商家管理员可访问');return {ok:true,data:await catalog(true)}}
  if(a==='updateProduct'){
   if(!isAdmin(openid))fail('仅商家管理员可修改商品');
   if(typeof event.id!=='string'||!/^[a-zA-Z0-9_-]{1,60}$/.test(event.id)||typeof event.token!=='string'||!/^[a-zA-Z0-9_-]{8,80}$/.test(event.token))fail('保存标识无效');
   const opId=crypto.createHash('sha256').update(openid+':'+event.token).digest('hex'),signature=JSON.stringify({id:event.id,patch:event.patch});
   const product=await db.runTransaction(async tx=>{
    const log=tx.collection('inventory_changes').doc(opId);let old;try{old=(await log.get()).data}catch(e){if(!/not exist|not found|不存在/i.test(e.message||''))throw e}
    if(old){if(old.signature!==signature)fail('保存标识已用于其他修改');return old.product}
    const ref=tx.collection('products').doc(event.id),{data:p}=await ref.get(),updated=inventory.patchProduct(p,event.patch);
    await ref.update({data:{skus:updated.skus,active:updated.active,updatedAt:updated.updatedAt}});
    const result={...updated,id:event.id};await log.set({data:{_openid:openid,productId:event.id,signature,product:result,createdAt:Date.now()}});return result;
   });return {ok:true,data:product};
  }
  if(a==='orderPage'){
   const offset=event.offset===undefined?0:event.offset,limit=event.limit===undefined?20:event.limit,status=event.status||'all';
   if(!Number.isInteger(offset)||offset<0||offset>100000||!Number.isInteger(limit)||limit<1||limit>50||!['all','pending','paid','shipped','completed','cancelled','ready_pickup','refund_requested','refunded'].includes(status))fail('分页参数无效');
   const query={_openid:openid};if(status!=='all')query.status=status==='refund_requested'?db.command.in(['refund_requested','refunded']):status;
   const {data:rows}=await db.collection('orders').where(query).orderBy('createdAt','desc').orderBy('_id','desc').skip(offset).limit(limit+1).get();
   return {ok:true,data:{orders:rows.slice(0,limit),hasMore:rows.length>limit,nextOffset:offset+limit}};
  }
  if(a==='whoami')return {ok:true,data:{openid,isAdmin:isAdmin(openid)}};
  if(a==='createOrder'){
   const privacyConsent=consent.validateConsent(event.privacyConsent);
   if(process.env.ENABLE_CHECKOUT!=='true')fail('商城尚未开放正式交易');pay.config();const policy=shippingPolicy(),fulfillment=domain.validateFulfillment(event,event.address,policy,true);if(typeof event.token!=='string'||!/^[a-zA-Z0-9_-]{8,80}$/.test(event.token))fail('下单标识无效');
   const id='G'+crypto.createHash('sha256').update(openid+':'+event.token).digest('hex').slice(0,28);
   const data=await db.runTransaction(async tx=>{const ref=tx.collection('orders').doc(id);let existing;try{existing=(await ref.get()).data}catch(e){if(!/not exist|not found|不存在/i.test(e.message||''))throw e}if(existing)return existing;const all=await catalog();const ids=[...new Set((event.items||[]).map(i=>{const p=all.find(p=>p.skus.some(s=>s.id===i.skuId));if(!p)fail('商品不存在');return p.id}))];const products=[];for(const pid of ids){const p=(await tx.collection('products').doc(pid).get()).data;if(p.needsReview)fail(p.name+'尚未核对售卖资料');products.push({...p,id:pid})}const q=domain.quote(products,event.items,policy,fulfillment);if(q.shippingError)fail(q.shippingError);for(const p of products){q.lines.filter(l=>l.productId===p.id).forEach(l=>p.skus.find(s=>s.id===l.skuId).stock-=l.qty);await tx.collection('products').doc(p.id).update({data:{skus:p.skus}})}const order={id,_openid:openid,token:event.token,...q,...fulfillment,privacyConsent,status:'pending',lock:'',demo:false,createdAt:Date.now(),expiresAt:Date.now()+15*60*1000};await ref.set({data:order});return order});return {ok:true,data};
  }
  if(a==='orders')return {ok:true,data:(await db.collection('orders').where({_openid:openid}).orderBy('createdAt','desc').limit(100).get()).data};
  if(a==='adminOrders'){if(!isAdmin(openid))fail('仅商家管理员可访问');return {ok:true,data:(await db.collection('orders').orderBy('createdAt','desc').limit(100).get()).data}}
  if(a==='expireOrders'){if(!isAdmin(openid))fail('仅商家管理员可访问');const {data:orders}=await db.collection('orders').where({status:'pending',expiresAt:db.command.lt(Date.now())}).limit(100).get();let count=0;for(const o of orders){if(o.lock)continue;await cancel(o);count++}return {ok:true,data:{count}}}
  const o=await readOrder(event.id,openid,['ship','order','preparePickup','completePickup'].includes(a));
  if(a==='order')return {ok:true,data:o};
  if(a==='syncPayment'){if(o.status==='pending')await sync(o.id);return {ok:true,data:await readOrder(o.id,openid)}};
  if(a==='pay'){if(o.expiresAt<=Date.now())fail('订单已超过付款时间，请取消后重新下单');await update(o.id,x=>x.status==='pending'&&!x.lock,{lock:'pay'});try{return {ok:true,data:await pay.create(o)}}finally{await db.runTransaction(async tx=>{const ref=tx.collection('orders').doc(o.id),{data:x}=await ref.get();if(x.status==='pending'&&x.lock==='pay')await ref.update({data:{lock:''}})})}}
  if(a==='cancel')return {ok:true,data:await cancel(o)};
  if(a==='receive')return {ok:true,data:await update(o.id,x=>x._openid===openid&&x.status==='shipped',{status:'completed',receivedAt:Date.now()})};
  if(a==='refund'){if(typeof event.reason!=='string'||event.reason.trim().length<3||event.reason.length>300)fail('请填写售后原因');return {ok:true,data:await update(o.id,x=>x._openid===openid&&['paid','shipped','ready_pickup','completed'].includes(x.status),{status:'refund_requested',refundReason:event.reason.trim(),refundAt:Date.now()})}}
  if(a==='preparePickup'){
   if(!isAdmin(openid))fail('仅商家管理员可备货');
   return {ok:true,data:await update(o.id,x=>x.status==='paid'&&x.deliveryMode==='pickup',{status:'ready_pickup',pickupCode:String(crypto.randomInt(100000,1000000)),readyAt:Date.now()})};
  }
  if(a==='completePickup'){
   if(!isAdmin(openid))fail('仅商家管理员可核销');if(typeof event.pickupCode!=='string'||!/^\d{6}$/.test(event.pickupCode))fail('请填写6位自取码');
   return {ok:true,data:await update(o.id,x=>x.status==='ready_pickup'&&x.deliveryMode==='pickup'&&x.pickupCode===event.pickupCode,{status:'completed',receivedAt:Date.now()})};
  }
  if(a==='ship'){if(!isAdmin(openid))fail('仅商家管理员可发货');if(typeof event.carrier!=='string'||typeof event.tracking!=='string'||!event.carrier.trim()||event.carrier.length>40||!/^[a-zA-Z0-9-]{5,40}$/.test(event.tracking))fail('请填写有效快递公司与单号');return {ok:true,data:await update(o.id,x=>x.status==='paid'&&x.deliveryMode!=='pickup',{status:'shipped',carrier:event.carrier.trim(),tracking:event.tracking,shippedAt:Date.now()})}}
  fail('不支持的操作');
 }catch(e){return {ok:false,message:e.message||'服务暂不可用'}}
};
