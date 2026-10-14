const config=require('../config'),seed=require('../data/products'),domain=require('./domain'),inventory=require('./inventory'),presentation=require('./presentation'),privacy=require('./privacy'),runtime=require('./runtime'),promotionRules=require('./promotion');
const KEY='guzi.template.demo.v1';
const clone=x=>JSON.parse(JSON.stringify(x));
function read(){runtime.assertReady(config);return wx.getStorageSync(KEY)||{products:clone(seed),orders:[]}}
function write(s){runtime.assertReady(config);wx.setStorageSync(KEY,s)}
const statusNames={pending:'待付款',paid:'待发货',shipped:'待收货',ready_pickup:'待自取',completed:'已完成',cancelled:'已取消',refund_requested:'售后处理中',refunded:'已退款'};
function orderStatusName(o){if(o.kind==='payment_test')return ({pending:'待测试付款',paid:'测试已付款',cancelled:'测试已取消'})[o.status]||statusNames[o.status];return o.deliveryMode==='pickup'&&o.status==='paid'?'待备货':statusNames[o.status]}
function money(n){return (n/100).toFixed(2)}
function decorate(p,promotion=config.promotion){const skus=p.skus.map(k=>({...k,salePrice:domain.salePrice(k.price,promotion)}));return {...p,displayName:presentation.productTitle(p),skus,priceText:money(Math.min(...skus.map(k=>k.salePrice))),originalPriceText:money(Math.min(...skus.map(k=>k.price))),discountBps:promotion.enabled?promotion.discountBps:10000,hasDiscount:!!promotion.enabled,promotionTitle:promotion.title,stock:skus.reduce((n,s)=>n+s.stock,0)}}
async function cloud(action,data={}){await runtime.ready(config);if(config.mode!=='cloud')throw new Error('当前开发模式未接入云端店铺');let response;try{response=await wx.cloud.callFunction({name:'commerce',data:{...data,action}})}catch(e){throw new Error('暂时无法连接店铺，请稍后重试')}const result=response&&response.result;if(!result||result.ok!==true)throw new Error(result&&result.message||'店铺服务尚未准备好，请联系店主');return result.data}
async function catalog(policy){await runtime.ready(config);policy=policy||await shippingPolicy();return (config.mode==='demo'?read().products:await cloud('catalog')).filter(p=>p.active).map(p=>decorate(p,policy.promotion))}
async function createOrder(items,address,token,options={}){
 await runtime.ready(config);
 privacy.assertConsent();
 if(config.mode==='cloud')return cloud('createOrder',{items,address,token,...options,privacyConsent:privacy.snapshot()});
 const state=read(),old=state.orders.find(o=>o.token===token);if(old)return old;
 const policy=demoPolicy(state),fulfillment=domain.validateFulfillment(options,address,policy),q=domain.quote(state.products,items,policy,fulfillment);if(q.shippingError)throw new Error(q.shippingError);
 q.lines.forEach(l=>{state.products.find(p=>p.id===l.productId).skus.find(s=>s.id===l.skuId).stock-=l.qty});
 const o={expiresAt:Date.now()+15*60*1000,id:'D'+Date.now()+Math.random().toString(36).slice(2,8),token,...q,...fulfillment,privacyConsent:privacy.snapshot(),status:'pending',createdAt:Date.now(),demo:true};state.orders.unshift(o);write(state);return o;
}
function demoPolicy(state=read()){return {promotion:state.promotion||config.promotion,freeShipping:config.freeShipping,freeShippingBasis:config.freeShippingBasis,shippingFee:config.shippingFee,pickupEnabled:config.pickupEnabled,pickupLocation:config.pickupLocation,pickupHours:config.pickupHours}}
async function shippingPolicy(){await runtime.ready(config);return config.mode==='demo'?demoPolicy():cloud('shippingPolicy')}
async function isAdmin(){await runtime.ready(config);return config.mode==='demo'?config.demoAdminEnabled===true:(await cloud('whoami')).isAdmin===true}
async function ensureAdmin(){if(!await isAdmin())throw new Error('当前用户没有店铺管理权限')}
async function adminProducts(){await ensureAdmin();const policy=await shippingPolicy();return (config.mode==='demo'?read().products:await cloud('adminProducts')).map(p=>decorate(p,policy.promotion))}
async function adminPromotion(){await ensureAdmin();return config.mode==='demo'?shippingPolicy():cloud('adminPromotion')}
async function setPromotion(discount){await ensureAdmin();const promotion=promotionRules.parseDiscount(discount);if(config.mode==='cloud')return cloud('setPromotion',{discount});const state=read();state.promotion=promotion;write(state);return {promotion,revision:Date.now()}}
async function updateProduct(id,patch,token){
 await ensureAdmin();
 if(typeof token!=='string'||!/^[a-zA-Z0-9_-]{8,80}$/.test(token))throw new Error('保存标识无效');
 if(config.mode==='cloud')return cloud('updateProduct',{id,patch,token});
 const state=read();state.managementRequests=state.managementRequests||{};const old=Object.prototype.hasOwnProperty.call(state.managementRequests,token)?state.managementRequests[token]:null;
 if(old){if(old.id!==id||JSON.stringify(old.patch)!==JSON.stringify(patch))throw new Error('保存标识已用于其他修改');return old.product}
 const i=state.products.findIndex(p=>p.id===id);const product=inventory.patchProduct(state.products[i],patch);
 state.products[i]=product;state.managementRequests[token]={id,patch:clone(patch),product};write(state);return product;
}
function requestToken(){return 'P'+Date.now()+'_'+Math.random().toString(36).slice(2)}
async function uploadProductFile(file,purpose,token){
 await ensureAdmin();if(config.mode!=='cloud')throw new Error('文件上传需连接云端店铺');
 if(!file||typeof file.path!=='string'||!file.size||file.size>(purpose==='import'?10:8)*1024*1024)throw new Error(purpose==='import'?'Excel文件需小于10MB':'商品图片需小于8MB');
 let ext=(file.name||file.path).split('.').pop().toLowerCase();if(purpose==='image'&&!['png','jpg','jpeg','gif','webp'].includes(ext))ext='jpg';
 const {cloudPath}=await cloud('prepareProductFile',{purpose,ext,token});
 const uploaded=await wx.cloud.uploadFile({cloudPath,filePath:file.path});if(!uploaded.fileID)throw new Error('文件上传失败，请重试');return uploaded.fileID;
}
async function createProduct(draft,imageFileIDs,token){
 const gallery=Array.isArray(imageFileIDs)?imageFileIDs:imageFileIDs?[imageFileIDs]:[];const imageFileID=gallery[0]||'';
 await ensureAdmin();const rules=require('./product-draft'),normalized=rules.normalize(draft);
 if(config.mode==='cloud')return cloud('createProduct',{draft:normalized,imageFileIDs:gallery,token});
 const state=read();state.productRequests=state.productRequests||{};const signature=JSON.stringify({draft:normalized,imageFileIDs:gallery});
 if(state.productRequests[token]){const old=state.productRequests[token];if(old.signature!==signature)throw new Error('保存标识已用于其他商品');return state.products.find(p=>p.id===old.id)}
 const id='np_'+token,product={...rules.build(normalized,id,imageFileID),gallery};state.products.push(product);state.productRequests[token]={id,signature};write(state);return product;
}
async function updateProductInfo(id,info){await ensureAdmin();if(config.mode==='cloud')return cloud('updateProductInfo',{id,...info});const rules=require('./product-draft'),state=read(),p=state.products.find(p=>p.id===id);if(!p)throw new Error('商品不存在');const normalized=rules.normalize({...p,priceCents:p.skus[0].price,stock:p.skus[0].stock,...info});for(const k of ['name','description','ip','type','group'])p[k]=normalized[k];if(info.imageFileIDs){p.image=info.imageFileIDs[0]||'/assets/placeholder.jpg';p.gallery=info.imageFileIDs;if(!p.gallery.length){p.active=false;p.needsReview=true}}else if(info.imageFileID){p.image=info.imageFileID;p.gallery=[info.imageFileID]}write(state);return p}
async function previewProductImport(fileID,group){await ensureAdmin();return cloud('previewProductImport',{fileID,group})}
async function commitProductImport(jobId,offset){await ensureAdmin();return cloud('commitProductImport',{jobId,offset})}
async function productImportTemplate(){await ensureAdmin();return cloud('getProductImportTemplate')}
async function orderPage({offset=0,status='all',limit=20}={}){
 await runtime.ready(config);
 if(config.mode==='cloud')return cloud('orderPage',{offset,status,limit});
 let list=read().orders.filter(o=>status==='all'||(status==='refund_requested'?['refund_requested','refunded'].includes(o.status):o.status===status));
 return {orders:list.slice(offset,offset+limit),hasMore:list.length>offset+limit,nextOffset:offset+limit};
}
async function orders(){await runtime.ready(config);return config.mode==='demo'?read().orders:cloud('orders')}
async function order(id){await runtime.ready(config);return config.mode==='demo'?read().orders.find(o=>o.id===id):cloud('order',{id})}
async function action(id,type,data={}){
 await runtime.ready(config);
 if(config.mode==='cloud')return cloud(type,{id,...data});
 if(['ship','preparePickup','completePickup'].includes(type))await ensureAdmin();
 const s=read(),o=s.orders.find(o=>o.id===id);if(!o)throw new Error('订单不存在');
 if(type==='demoPay'&&o.status==='pending'){if(o.expiresAt&&o.expiresAt<=Date.now())throw new Error('订单已超过付款时间，请取消后重新下单');o.status='paid';o.paidAt=Date.now()}
 else if(type==='cancel'&&o.status==='pending'){o.status='cancelled';o.cancelledAt=Date.now();o.lines.forEach(l=>s.products.find(p=>p.id===l.productId).skus.find(k=>k.id===l.skuId).stock+=l.qty)}
 else if(type==='preparePickup'&&o.status==='paid'&&o.deliveryMode==='pickup'){o.status='ready_pickup';o.pickupCode=String(Math.floor(100000+Math.random()*900000));o.readyAt=Date.now()}
 else if(type==='completePickup'&&o.status==='ready_pickup'&&o.deliveryMode==='pickup'){if(typeof data.pickupCode!=='string'||data.pickupCode!==o.pickupCode)throw new Error('自取码不正确，请核对');o.status='completed';o.receivedAt=Date.now()}
 else if(type==='receive' &&o.status==='shipped'){o.status='completed';o.receivedAt=Date.now()}
 else if(type==='refund'&&['paid','shipped','ready_pickup','completed'].includes(o.status)){if(typeof data.reason!=='string'||data.reason.trim().length<3||data.reason.length>300)throw new Error('请填写3至300字的售后原因');o.status='refund_requested';o.refundReason=data.reason.trim();o.refundAt=Date.now()}
 else if(type==='ship'&&o.status==='paid'&&o.deliveryMode!=='pickup'){if(typeof data.carrier!=='string'||!data.carrier.trim()||data.carrier.length>40||typeof data.tracking!=='string'||!/^[a-zA-Z0-9-]{5,40}$/.test(data.tracking.trim()))throw new Error('请填写有效快递公司与单号');o.status='shipped';o.tracking=data.tracking.trim();o.carrier=data.carrier.trim();o.shippedAt=Date.now()}
 else throw new Error('当前状态不允许此操作');write(s);return o;
}
function quickAdd(p){
 if(!p||p.active===false)throw new Error('商品已下架');
 if(p.skus.length!==1)return false;
 const sku=p.skus[0],existing=cart().find(i=>i.skuId===sku.id),quantity=existing?existing.qty:0;
 if(sku.stock<1)throw new Error('商品已售罄');
 if(quantity>=Math.min(99,sku.stock))throw new Error('已达到可购买数量');
 add(sku.id,1);return true;
}
function cart(){return wx.getStorageSync('cart.v1')||[]}
function saveCart(items){wx.setStorageSync('cart.v1',items)}
function add(skuId,qty){const c=cart(),x=c.find(i=>i.skuId===skuId);if(x){x.qty=Math.min(99,x.qty+qty);x.selected=true;}else c.push({skuId,qty,selected:true});saveCart(c)}
const ADDRESS_KEY='addresses.v2';
function addresses(){
 if(!privacy.hasConsent())return [];
 const current=wx.getStorageSync(ADDRESS_KEY);if(current)return current;
 const legacy=wx.getStorageSync('address.v1');const list=legacy?[{...domain.validateAddress(legacy),id:'legacy-default',isDefault:true}]:[];wx.setStorageSync(ADDRESS_KEY,list);return list;
}
function address(){const list=addresses(),selected=wx.getStorageSync('address.selected.v2');return list.find(a=>a.id===selected)||list.find(a=>a.isDefault)||list[0]||null}
function chooseAddress(id){privacy.assertConsent();if(!addresses().some(a=>a.id===id))throw new Error('地址不存在');wx.setStorageSync('address.selected.v2',id)}
function saveAddress(a,{id,isDefault=false,select=false}={}){
 privacy.assertConsent();
 const valid=domain.validateAddress(a),list=addresses(),index=id?list.findIndex(x=>x.id===id):-1;
 if(id&&index<0)throw new Error('地址不存在');if(index<0&&list.length>=20)throw new Error('最多保存20个地址');
 const value={...valid,id:id||'A'+Date.now()+Math.random().toString(36).slice(2,8),isDefault:isDefault||!list.length||(index>=0&&list[index].isDefault)};
 if(value.isDefault)list.forEach(x=>x.isDefault=false);index>=0?list[index]=value:list.push(value);
 wx.setStorageSync(ADDRESS_KEY,list);if(select||isDefault)chooseAddress(value.id);return value;
}
function defaultAddress(id){privacy.assertConsent();const list=addresses();if(!list.some(a=>a.id===id))throw new Error('地址不存在');list.forEach(a=>a.isDefault=a.id===id);wx.setStorageSync(ADDRESS_KEY,list);chooseAddress(id)}
function deleteAddress(id){const list=addresses().filter(a=>a.id!==id);if(list.length&&!list.some(a=>a.isDefault))list[0].isDefault=true;wx.setStorageSync(ADDRESS_KEY,list);if(wx.getStorageSync('address.selected.v2')===id)wx.removeStorageSync('address.selected.v2')}
function favorites(){return wx.getStorageSync('favorites.v1')||[]}
function toggleFavorite(id){const f=favorites(),i=f.indexOf(id);i<0?f.push(id):f.splice(i,1);wx.setStorageSync('favorites.v1',f);return f.includes(id)}
function err(e){wx.showToast({title:e.message||'操作失败，请重试',icon:'none',duration:3000})}
async function pay(o){
 await runtime.ready(config);
 if(!o||!o.id)throw new Error('订单不存在');
 if(config.mode==='demo'){
  const r=await new Promise(resolve=>wx.showModal({title:'演示支付 · 不扣款',content:'此操作只模拟订单付款，不能购买真实商品。',confirmText:'模拟付款',success:resolve}));
  if(r.confirm)await action(o.id,'demoPay');return;
 }
 if(o.demo)throw new Error('这是旧试用订单，请重新下单');
 const p=await cloud('pay',{id:o.id});let paymentError=null;
 try{await new Promise((resolve,reject)=>wx.requestPayment({...p,success:resolve,fail:reject}))}catch(e){paymentError=e}
 let synced;try{synced=await cloud('syncPayment',{id:o.id})}catch(e){
  if(paymentError&&/cancel/i.test(paymentError.errMsg||paymentError.message||''))throw new Error('已取消付款，订单仍待付款');
  throw new Error('付款结果暂未核对，请刷新订单状态，避免重复付款');
 }
 if(synced&&['paid','shipped','ready_pickup','completed'].includes(synced.status))return synced;
 if(paymentError)throw new Error(/cancel/i.test(paymentError.errMsg||paymentError.message||'')?'已取消付款，订单仍待付款':'付款未完成，请刷新订单状态');
 throw new Error('支付结果仍在确认，请刷新订单状态，避免重复付款');
}
async function adminOrderPage({offset=0,status='all',limit=20,cursor=null,deliveryMode='all',keyword=''}={}){
 await ensureAdmin();
 if(config.mode==='cloud')return cloud('adminOrderPage',{offset,status,limit,cursor,deliveryMode,keyword});
 const key=keyword.trim().toLowerCase(),list=read().orders.filter(o=>(status==='all'||(status==='refund_requested'?['refund_requested','refunded'].includes(o.status):o.status===status))&&(deliveryMode==='all'||(deliveryMode==='pickup'?o.deliveryMode==='pickup':o.deliveryMode!=='pickup'&&o.kind!=='payment_test'))&&(!key||[o.id,o.address&&o.address.phone,o.pickupContact&&o.pickupContact.phone].some(x=>String(x||'').toLowerCase().includes(key))));return {orders:list.slice(offset,offset+limit),hasMore:list.length>offset+limit,nextOffset:offset+limit};
}
async function merchantOverview(){await ensureAdmin();if(config.mode==='cloud')return cloud('merchantOverview');const orders=read().orders.filter(o=>o.kind!=='payment_test'),count=fn=>orders.filter(fn).length;return {...require('./shop-analytics').paidSummary(orders,Date.now(),true),deliveryToShip:count(o=>o.status==='paid'&&o.deliveryMode!=='pickup'),pickupToPrepare:count(o=>o.status==='paid'&&o.deliveryMode==='pickup'),pickupReady:count(o=>o.status==='ready_pickup'),refundRequests:count(o=>o.status==='refund_requested'),shippingUnsynced:0}}
async function inventoryHistory(id){await ensureAdmin();if(config.mode==='cloud')return cloud('inventoryHistory',{id});return Object.values(read().managementRequests||{}).filter(x=>x.id===id).map(x=>({createdAt:x.product.updatedAt,operator:'当前账号',stockDelta:x.patch.stockDelta,priceCents:x.patch.priceCents,skuName:x.product.skus.find(y=>y.id===x.patch.skuId).name,active:x.product.active})).reverse().slice(0,30)}
async function exportMerchantData(kind,from,to){await ensureAdmin();return cloud('exportMerchantData',{kind,from,to})}
async function merchantIdentity(){await ensureAdmin();return config.mode==='demo'?{openid:'demo'}:cloud('whoami')}
async function createPaymentTestOrder(token){
 await ensureAdmin();if(config.mode!=='cloud')throw new Error('支付测试需要连接真实云端店铺');privacy.assertConsent();
 return cloud('createPaymentTestOrder',{token,privacyConsent:privacy.snapshot()});
}

function clearPersonalData(){runtime.assertReady(config);if(config.mode!=='demo')throw new Error('正式订单信息请联系店主申请处理');[KEY,'addresses.v2','address.v1','address.selected.v2','checkout.v1'].forEach(k=>wx.removeStorageSync(k));privacy.revoke()}
module.exports={...presentation,merchantOverview,inventoryHistory,exportMerchantData,merchantIdentity,requestToken,uploadProductFile,createProduct,updateProductInfo,previewProductImport,commitProductImport,productImportTemplate,adminPromotion,setPromotion,adminOrderPage,createPaymentTestOrder,clearPersonalData,isAdmin,ensureAdmin,quickAdd,config,catalog,shippingPolicy,adminProducts,updateProduct,orderPage,createOrder,orders,order,action,cart,saveCart,add,address,addresses,chooseAddress,saveAddress,defaultAddress,deleteAddress,favorites,toggleFavorite,money,statusNames,orderStatusName,err,pay,cloud};
