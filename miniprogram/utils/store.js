const config=require('../config'),seed=require('../data/products'),domain=require('./domain'),inventory=require('./inventory'),presentation=require('./presentation'),privacy=require('./privacy');
const KEY='guzi.template.demo.v1';
const clone=x=>JSON.parse(JSON.stringify(x));
function read(){return wx.getStorageSync(KEY)||{products:clone(seed),orders:[]}}
function write(s){wx.setStorageSync(KEY,s)}
const statusNames={pending:'待付款',paid:'待发货',shipped:'待收货',ready_pickup:'待自取',completed:'已完成',cancelled:'已取消',refund_requested:'售后处理中',refunded:'已退款'};
function orderStatusName(o){return o.deliveryMode==='pickup'&&o.status==='paid'?'待备货':statusNames[o.status]}
function money(n){return (n/100).toFixed(2)}
function decorate(p){const skus=p.skus.map(k=>({...k,salePrice:domain.salePrice(k.price,config.promotion)}));return {...p,displayName:presentation.productTitle(p),skus,priceText:money(Math.min(...skus.map(k=>k.salePrice))),originalPriceText:money(Math.min(...skus.map(k=>k.price))),hasDiscount:!!config.promotion.enabled,stock:skus.reduce((n,s)=>n+s.stock,0)}}
async function cloud(action,data={}){const {result}=await wx.cloud.callFunction({name:'commerce',data:{action,...data}});if(!result.ok)throw new Error(result.message||'服务暂不可用');return result.data}
async function catalog(){return (config.mode==='demo'?read().products:await cloud('catalog')).filter(p=>p.active).map(decorate)}
async function createOrder(items,address,token,options={}){
 privacy.assertConsent();
 if(config.mode==='cloud')return cloud('createOrder',{items,address,token,...options,privacyConsent:privacy.snapshot()});
 const state=read(),old=state.orders.find(o=>o.token===token);if(old)return old;
 const fulfillment=domain.validateFulfillment(options,address,config),q=domain.quote(state.products,items,config,fulfillment);if(q.shippingError)throw new Error(q.shippingError);
 q.lines.forEach(l=>{state.products.find(p=>p.id===l.productId).skus.find(s=>s.id===l.skuId).stock-=l.qty});
 const o={expiresAt:Date.now()+15*60*1000,id:'D'+Date.now()+Math.random().toString(36).slice(2,8),token,...q,...fulfillment,privacyConsent:privacy.snapshot(),status:'pending',createdAt:Date.now(),demo:true};state.orders.unshift(o);write(state);return o;
}
async function shippingPolicy(){return config.mode==='demo'?{promotion:config.promotion,freeShipping:config.freeShipping,freeShippingBasis:config.freeShippingBasis,shippingFee:config.shippingFee,pickupEnabled:config.pickupEnabled,pickupLocation:config.pickupLocation,pickupHours:config.pickupHours}:cloud('shippingPolicy')}
async function isAdmin(){return config.mode==='demo'?config.demoAdminEnabled===true:(await cloud('whoami')).isAdmin===true}
async function ensureAdmin(){if(!await isAdmin())throw new Error('当前用户没有店铺管理权限')}
async function adminProducts(){await ensureAdmin();return (config.mode==='demo'?read().products:await cloud('adminProducts')).map(decorate)}
async function updateProduct(id,patch,token){
 await ensureAdmin();
 if(typeof token!=='string'||!/^[a-zA-Z0-9_-]{8,80}$/.test(token))throw new Error('保存标识无效');
 if(config.mode==='cloud')return cloud('updateProduct',{id,patch,token});
 const state=read();state.managementRequests=state.managementRequests||{};const old=Object.prototype.hasOwnProperty.call(state.managementRequests,token)?state.managementRequests[token]:null;
 if(old){if(old.id!==id||JSON.stringify(old.patch)!==JSON.stringify(patch))throw new Error('保存标识已用于其他修改');return old.product}
 const i=state.products.findIndex(p=>p.id===id);const product=inventory.patchProduct(state.products[i],patch);
 state.products[i]=product;state.managementRequests[token]={id,patch:clone(patch),product};write(state);return product;
}
async function orderPage({offset=0,status='all',limit=20}={}){
 if(config.mode==='cloud')return cloud('orderPage',{offset,status,limit});
 let list=read().orders.filter(o=>status==='all'||(status==='refund_requested'?['refund_requested','refunded'].includes(o.status):o.status===status));
 return {orders:list.slice(offset,offset+limit),hasMore:list.length>offset+limit,nextOffset:offset+limit};
}
async function orders(){return config.mode==='demo'?read().orders:cloud('orders')}
async function order(id){return config.mode==='demo'?read().orders.find(o=>o.id===id):cloud('order',{id})}
async function action(id,type,data={}){
 if(config.mode==='cloud')return cloud(type,{id,...data});
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
async function pay(o){if(config.mode==='demo'){const r=await new Promise(resolve=>wx.showModal({title:'演示支付 · 不扣款',content:'此操作只模拟订单付款，不能购买真实商品。',confirmText:'模拟付款',success:resolve}));if(r.confirm)await action(o.id,'demoPay');return}const p=await cloud('pay',{id:o.id});await new Promise((resolve,reject)=>wx.requestPayment({...p,success:resolve,fail:reject}));await cloud('syncPayment',{id:o.id})}
function clearPersonalData(){if(config.mode!=='demo')throw new Error('正式订单信息请联系店主申请处理');[KEY,'addresses.v2','address.v1','address.selected.v2','checkout.v1'].forEach(k=>wx.removeStorageSync(k));privacy.revoke()}
module.exports={...presentation,clearPersonalData,isAdmin,ensureAdmin,quickAdd,config,catalog,shippingPolicy,adminProducts,updateProduct,orderPage,createOrder,orders,order,action,cart,saveCart,add,address,addresses,chooseAddress,saveAddress,defaultAddress,deleteAddress,favorites,toggleFavorite,money,statusNames,orderStatusName,err,pay,cloud};
