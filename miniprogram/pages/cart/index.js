const s=require('../../utils/store'),ui=require('../../utils/ui');
Page({
 data:{lines:[],total:'0.00',count:0,shippingHint:'',shippingProgress:0,shippingText:s.shippingDescription(s.config),error:'',loading:true},
 onShow(){ui.resume(this);return this.reload()},onHide(){ui.suspend(this)},onUnload(){ui.suspend(this)},
 async reload(){const request=ui.request(this);this.setData({loading:true,error:''});try{const policy=await s.shippingPolicy(),products=await s.catalog(policy);if(!ui.current(this,request))return;this.products=products;this.policy=policy;this.recalculate()}catch(e){if(ui.current(this,request)){this.setData({error:e.message});s.err(e)}}finally{if(ui.current(this,request))this.setData({loading:false})}},
 recalculate(){
  if(!this.products||!this.policy)return;
  const skus=new Map();this.products.forEach(p=>p.skus.forEach(k=>skus.set(k.id,{p,k})));
  const lines=s.cart().map(i=>{const entry=skus.get(i.skuId)||{},p=entry.p,k=entry.k;return {...i,hasDiscount:p&&p.hasDiscount,name:p?p.displayName:'商品已下架',image:p?p.image:'',skuName:k?k.name:'',stock:k?k.stock:0,price:k?s.money(k.salePrice):'—',originalPrice:k?s.money(k.price):'—',invalid:!k||!Number.isInteger(i.qty)||i.qty<1||i.qty>99||k.stock<i.qty}}),chosen=lines.filter(l=>l.selected&&!l.invalid),valid=lines.filter(l=>!l.invalid);
  const subtotal=chosen.reduce((n,l)=>n+skus.get(l.skuId).k.salePrice*l.qty,0),progress=s.shippingProgress(subtotal,chosen.length,this.policy);
  this.setData({...progress,shippingText:s.shippingDescription(this.policy),lines,allSelected:valid.length>0&&valid.every(l=>l.selected),count:chosen.reduce((n,l)=>n+l.qty,0),total:s.money(subtotal)});
 },
 toggle(e){const c=s.cart(),x=c.find(x=>x.skuId===e.currentTarget.dataset.id);if(!x)return;x.selected=!x.selected;s.saveCart(c);this.recalculate()},
 toggleAll(){const c=s.cart(),valid=new Set(this.data.lines.filter(l=>!l.invalid).map(l=>l.skuId)),select=!this.data.allSelected;c.forEach(i=>{if(valid.has(i.skuId))i.selected=select});s.saveCart(c);return this.recalculate()},
 browse(){ui.navigate(this,'/pages/home/index','switchTab')},
 qty(e){const c=s.cart(),x=c.find(x=>x.skuId===e.currentTarget.dataset.id),line=this.data.lines.find(l=>l.skuId===e.currentTarget.dataset.id);if(!x||!line||line.stock<1)return;const next=x.qty+Number(e.currentTarget.dataset.delta);if(next>line.stock||next>99)return s.err(new Error('已达到可购买数量'));x.qty=Math.max(1,next);s.saveCart(c);return this.recalculate()},
 remove(e){s.saveCart(s.cart().filter(x=>x.skuId!==e.currentTarget.dataset.id));this.recalculate()},
 checkout(){if(this._navigating)return;const c=this.data.lines.filter(l=>l.selected&&!l.invalid).map(l=>({skuId:l.skuId,qty:l.qty}));if(!c.length)return s.err(new Error('请选择有库存的商品'));wx.setStorageSync('checkout.v1',c);ui.navigate(this,'/pages/checkout/index?source=cart')}
});
