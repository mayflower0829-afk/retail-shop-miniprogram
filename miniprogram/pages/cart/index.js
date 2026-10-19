const s=require('../../utils/store'),ui=require('../../utils/ui');
function unavailable(entry){return !entry||entry.p.active===false||Number.isInteger(entry.k.stock)&&entry.k.stock<=0}
Page({
 data:{lines:[],total:'0.00',count:0,shippingHint:'',shippingProgress:0,shippingText:s.shippingDescription(s.config),error:'',loading:true},
 onShow(){ui.resume(this);return this.reload()},onHide(){ui.suspend(this)},onUnload(){ui.suspend(this)},
 async reload(){const request=ui.request(this);this.setData({loading:true,error:''});try{const policy=await s.shippingPolicy(),products=await s.catalog(policy);if(!ui.current(this,request))return;this.products=products;this.policy=policy;this.recalculate()}catch(e){if(ui.current(this,request)){this.setData({error:e.message});s.err(e)}}finally{if(ui.current(this,request))this.setData({loading:false})}},
 recalculate(){
  if(!this.products||!this.policy)return;
  const skus=new Map();this.products.forEach(p=>p.skus.forEach(k=>skus.set(k.id,{p,k})));
  const lines=s.cart().map(i=>{const entry=skus.get(i.skuId),p=entry&&entry.p,k=entry&&entry.k,gone=unavailable(entry),invalid=gone||!Number.isInteger(i.qty)||i.qty<1||i.qty>99||!Number.isInteger(k.stock)||k.stock<i.qty;return {...i,hasDiscount:p&&p.hasDiscount,name:p?p.displayName:'商品已下架',image:p?p.image:'',skuName:k?k.name:'',stock:k?k.stock:0,price:k?s.money(k.salePrice):'—',originalPrice:k?s.money(k.price):'—',unavailable:gone,invalid,invalidReason:!k||p.active===false?'商品已下架':gone?'这款暂时售罄':!Number.isInteger(k.stock)?'库存暂时无法确认，请刷新':Number.isInteger(i.qty)&&i.qty>k.stock?'仅剩'+k.stock+'件，请减少数量':'请将数量调整为1至99件'}}),chosen=lines.filter(l=>l.selected&&!l.invalid),valid=lines.filter(l=>!l.invalid);
  const subtotal=chosen.reduce((n,l)=>n+skus.get(l.skuId).k.salePrice*l.qty,0),progress=s.shippingProgress(subtotal,chosen.length,this.policy);
  this.setData({...progress,shippingText:s.shippingDescription(this.policy),unavailableCount:lines.filter(l=>l.unavailable).length,invalidSelectedCount:lines.filter(l=>l.selected&&l.invalid).length,lines,allSelected:valid.length>0&&valid.every(l=>l.selected),count:chosen.reduce((n,l)=>n+l.qty,0),total:s.money(subtotal)});
 },
 toggle(e){const c=s.cart(),x=c.find(x=>x.skuId===e.currentTarget.dataset.id);if(!x)return;x.selected=!x.selected;s.saveCart(c);this.recalculate()},
 toggleAll(){const c=s.cart(),valid=new Set(this.data.lines.filter(l=>!l.invalid).map(l=>l.skuId)),select=!this.data.allSelected;c.forEach(i=>{if(valid.has(i.skuId))i.selected=select});s.saveCart(c);return this.recalculate()},
 browse(){ui.navigate(this,'/pages/home/index','switchTab')},
 qty(e){const c=s.cart(),x=c.find(x=>x.skuId===e.currentTarget.dataset.id),line=this.data.lines.find(l=>l.skuId===e.currentTarget.dataset.id);if(!x||!line||line.stock<1)return;const delta=Number(e.currentTarget.dataset.delta);if(![-1,1].includes(delta))return;const next=x.qty+delta;if(delta>0&&(next>line.stock||next>99))return s.err(new Error('已达到可购买数量'));x.qty=Math.max(1,next);s.saveCart(c);return this.recalculate()},
 remove(e){s.saveCart(s.cart().filter(x=>x.skuId!==e.currentTarget.dataset.id));this.recalculate()},
 cleanUnavailable(){
  if(this._cleaning||this.data.loading||this.data.error||!this.data.unavailableCount)return;this._cleaning=true;const candidates=new Set(this.data.lines.filter(l=>l.unavailable).map(l=>l.skuId));
  wx.showModal({title:'清理无法购买的商品',content:'仅移除已下架或售罄的款式，其他商品会保留。',confirmText:'确认清理',success:result=>{
   if(!result.confirm||this._viewHidden||this.data.loading||this.data.error)return;
   const skus=new Map();(this.products||[]).forEach(p=>p.skus.forEach(k=>skus.set(k.id,{p,k})));
   s.saveCart(s.cart().filter(i=>!candidates.has(i.skuId)||!unavailable(skus.get(i.skuId))));this.recalculate();
  },complete:()=>{this._cleaning=false}});
 },
 checkout(){if(this._navigating||this.data.loading)return;if(this.data.error)return s.err(new Error('请先重新加载购物车'));if(this.data.invalidSelectedCount)return s.err(new Error('请先调整或取消勾选无法购买的商品'));const c=this.data.lines.filter(l=>l.selected&&!l.invalid).map(l=>({skuId:l.skuId,qty:l.qty}));if(!c.length)return s.err(new Error('请选择有库存的商品'));wx.setStorageSync('checkout.v1',c);ui.navigate(this,'/pages/checkout/index?source=cart')}
});
