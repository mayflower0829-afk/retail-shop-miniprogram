function fail(message){throw new Error(message)}
function validateContact(a){if(!a||typeof a.name!=='string'||!a.name.trim()||a.name.length>30)fail('请填写联系人姓名');if(!/^1\d{10}$/.test(a.phone||''))fail('请填写11位手机号');return {name:a.name.trim(),phone:a.phone}}
function validateAddress(a){const contact=validateContact(a);if(!Array.isArray(a.region)||a.region.length!==3||a.region.some(v=>typeof v!=='string'||!v.trim()))fail('请选择省市区');if(typeof a.detail!=='string'||a.detail.trim().length<5||a.detail.length>200)fail('请填写详细地址（至少5个字）');return {...contact,region:a.region,detail:a.detail.trim()}}
function salePrice(original,promotion){
 if(!Number.isSafeInteger(original)||original<=0||original>99999999)fail('商品价格无效');
 if(!promotion||!promotion.enabled)return original;
 if(!Number.isInteger(promotion.discountBps)||promotion.discountBps<1||promotion.discountBps>10000)fail('活动价格配置无效');
 return Math.max(1,Math.floor((original*promotion.discountBps+5000)/10000));
}
function validateFulfillment(options,address,policy,strict=false){
 const mode=options&&options.deliveryMode||'delivery';
 if(!['delivery','pickup'].includes(mode))fail('配送方式无效');
 if(mode==='delivery')return {deliveryMode:mode,address:validateAddress(address)};
 if(!policy.pickupEnabled)fail('店铺暂不支持自取');
 if(strict&&(!policy.pickupLocation||!policy.pickupHours))fail('店铺尚未配置自取地点和时间');
 return {deliveryMode:mode,address:null,pickupContact:validateContact(options.pickupContact),pickupLocation:policy.pickupLocation||'',pickupHours:policy.pickupHours||''};
}
function quote(products,items,policy,options={}){
 if(!Array.isArray(items)||!items.length||items.length>30)fail('请选择1至30种商品');
 const deliveryMode=options.deliveryMode||'delivery';if(!['delivery','pickup'].includes(deliveryMode))fail('配送方式无效');if(deliveryMode==='pickup'&&!policy.pickupEnabled)fail('店铺暂不支持自取');
 const merged=Object.create(null);items.forEach(i=>{if(!i||typeof i.skuId!=='string'||!Number.isInteger(i.qty)||i.qty<1||i.qty>99)fail('商品数量无效');merged[i.skuId]=(merged[i.skuId]||0)+i.qty;if(merged[i.skuId]>99)fail('单款限购99件')});
 let subtotal=0,originalSubtotal=0;
 const lines=Object.keys(merged).map(skuId=>{const p=products.find(p=>p.skus.some(s=>s.id===skuId));if(!p||!p.active)fail('商品已下架');const s=p.skus.find(s=>s.id===skuId),qty=merged[skuId];if(!Number.isInteger(s.stock)||s.stock<qty)fail(p.name+'库存不足');const price=salePrice(s.price,policy.promotion);subtotal+=price*qty;originalSubtotal+=s.price*qty;return {productId:p.id,skuId,name:p.name,skuName:s.name,image:p.image,originalPrice:s.price,price,qty}});
 if(!Number.isSafeInteger(policy.freeShipping)||policy.freeShipping<0)fail('包邮规则无效');
 const basis=policy.freeShippingBasis||'discounted';if(!['discounted','original'].includes(basis))fail('包邮规则无效');
 const shippingBasisSubtotal=basis==='original'?originalSubtotal:subtotal;
 let shippingFee=0,shippingError='';
 if(deliveryMode==='delivery'&&shippingBasisSubtotal<policy.freeShipping){if(!Number.isSafeInteger(policy.shippingFee)||policy.shippingFee<0){shippingFee=null;shippingError='未满69元的邮费待店铺确认，暂不能提交快递订单'}else shippingFee=policy.shippingFee}
 return {lines,originalSubtotal,discountAmount:originalSubtotal-subtotal,subtotal,shippingFee,total:shippingFee===null?null:subtotal+shippingFee,shippingError,deliveryMode,promotion:policy.promotion?{...policy.promotion}:null,freeShipping:policy.freeShipping,freeShippingBasis:basis};
}
module.exports={quote,validateAddress,validateContact,validateFulfillment,salePrice};
