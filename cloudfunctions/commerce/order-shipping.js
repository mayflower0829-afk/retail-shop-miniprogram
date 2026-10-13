// WeChat official order shipping APIs; cloud calls keep AppSecret out of the client.
const CARRIERS = [
 {id:'SF',name:'顺丰速运'}, {id:'STO',name:'申通快递'}, {id:'ZTO',name:'中通快递'},
 {id:'YTO',name:'圆通速递'}, {id:'YD',name:'韵达速递'}, {id:'JTSD',name:'极兔速递'},
 {id:'EMS',name:'EMS'}, {id:'DHL',name:'DHL'}
];
function enabled(env=process.env){return env.ENABLE_ORDER_SHIPPING==='true'}
function checkResult(r){const code=r&&(r.errcode===undefined?r.errCode:r.errcode);if(!r||code!==undefined&&code!==0){const e=new Error('微信发货信息未同步，请重试或在公众平台处理');e.code=code;throw e}return r}
function api(cloud){return cloud.openapi({convertCase:false}).wxa.sec.order}
function description(o){const text=(o.lines||[]).map(l=>String(l.name||'商品')+'×'+l.qty).join('；');if(!text)throw new Error('订单缺少商品信息');return [...text].slice(0,120).join('')}
function payload(o,env=process.env){
 if(!o||o.kind==='payment_test'||!o.transactionId||!o._openid)throw new Error('仅真实已付款商品订单可同步发货');
 const pickup=o.deliveryMode==='pickup';
 if(!pickup&&(!o.carrierCode||!/^[a-zA-Z0-9()_-]{1,40}$/.test(o.carrierCode)||!o.tracking||!/^[a-zA-Z0-9-]{5,40}$/.test(o.tracking)))throw new Error('请填写快递公司编码与有效单号');
 const line={item_desc:description(o)};
 if(!pickup){line.tracking_no=o.tracking;line.express_company=o.carrierCode;
  if(o.carrierCode==='SF'){const phone=o.address&&o.address.phone;if(typeof phone!=='string'||!/^1\d{10}$/.test(phone))throw new Error('顺丰订单缺少有效收件手机号');line.contact={receiver_contact:'****'+phone.slice(-4)}}
 }
 return {order_key:{order_number_type:2,transaction_id:o.transactionId},logistics_type:pickup?4:1,delivery_mode:1,shipping_list:[line],upload_time:new Date(o.shippedAt||o.readyAt||Date.now()).toISOString(),payer:{openid:o._openid}};
}
function matches(o,r){const x=r&&r.order;return !!(x&&x.transaction_id===o.transactionId&&x.merchant_trade_no===o.id&&x.merchant_id===process.env.WX_MCHID&&x.openid===o._openid&&x.paid_amount===o.total)}
function alreadyUploaded(o,r){if(!matches(o,r))return false;const x=r.order.shipping;if(!x||!x.finish_shipping||x.logistics_type!==(o.deliveryMode==='pickup'?4:1))return false;const list=x.shipping_list||[];return list.length===1&&(o.deliveryMode==='pickup'||list[0].tracking_no===o.tracking&&list[0].express_company===o.carrierCode)}
async function get(cloud,o){return checkResult(await api(cloud).getOrder({transaction_id:o.transactionId}))}
async function upload(cloud,o){
 const request=payload(o);
 // Query first: retrying an accepted upload must not consume the one re-shipping chance.
 const current=await get(cloud,o);
 if(!matches(o,current))throw new Error('微信发货订单与本店订单不匹配');
 if(alreadyUploaded(o,current))return {synced:true,alreadySynced:true};
 if(current.order.shipping&&current.order.shipping.finish_shipping)throw new Error('微信已记录其他发货信息，请在公众平台核对');
 checkResult(await api(cloud).uploadShippingInfo(request));return {synced:true,alreadySynced:false};
}
async function status(cloud,appid){const r=checkResult(await api(cloud).isTradeManaged({appid}));const value=r.is_trade_managed===undefined?r.isTradeManaged:r.is_trade_managed;if(typeof value!=='boolean')throw new Error('微信发货管理状态返回异常');return {managed:value}}
module.exports={CARRIERS,enabled,payload,matches,alreadyUploaded,get,upload,status};
