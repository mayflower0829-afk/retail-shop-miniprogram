const s=require('../../utils/store'),d=require('../../utils/domain'),privacy=require('../../utils/privacy'),consent=require('../../utils/consent-page'),ui=require('../../utils/ui');
Page({
 ...consent.methods,
 data:{...consent.data,address:null,lines:[],total:'—',shipping:'—',subtotal:'0.00',originalSubtotal:'0.00',discount:'0.00',busy:false,loading:true,quoteReady:false,hasQuote:false,orderCreated:false,error:'',notice:'',shippingError:'',shippingText:s.shippingDescription(s.config),shippingHint:'',deliveryMode:'delivery',pickupName:'',pickupPhone:'',pickupEnabled:true,pickupLocation:'',pickupHours:'',demo:s.config.mode==='demo'},
 onLoad(q={}){this.source=q.source;this.token=Date.now()+'_'+Math.random().toString(36).slice(2);this.items=wx.getStorageSync('checkout.v1')||[]},
 onShow(){ui.resume(this);if(this._createdOrder)return this.openOrder();if(!this.data.busy)return this.reload()},
 onHide(){ui.suspend(this)},onUnload(){ui.suspend(this)},
 onConsentGranted(){return this.reload()},
 async reload(){
  if(this.data.busy||this._createdOrder)return;
  const request=ui.request(this),mode=this.data.deliveryMode;
  if(!consent.refresh(this))this.setData({address:null,pickupName:'',pickupPhone:''});
  this.quote=null;this.setData({loading:true,quoteReady:false,error:'',notice:'',shippingError:''});
  try{
   const policy=await s.shippingPolicy(),products=await s.catalog(policy);
   if(!ui.current(this,request))return;
   const q=d.quote(products,this.items,policy,{deliveryMode:mode}),accepted=consent.refresh(this),a=accepted?s.address():null;
   const previous=this._lastQuote,changed=previous&&q.lines.some(l=>{const old=previous.lines.find(x=>x.skuId===l.skuId);return old&&old.price!==l.price});
   this.policy=policy;this.quote=q;this._lastQuote=q;
   this.setData({address:a,promotionTitle:policy.promotion.title,hasDiscount:policy.promotion.enabled,lines:q.lines.map(l=>({...l,displayName:s.lineTitle(l),priceText:s.money(l.price),originalPriceText:s.money(l.originalPrice)})),total:q.total===null?'—':s.money(q.total),shipping:q.shippingFee===null?'待确认':s.money(q.shippingFee),subtotal:s.money(q.subtotal),originalSubtotal:s.money(q.originalSubtotal),discount:s.money(q.discountAmount),shippingError:q.shippingError,shippingText:s.shippingDescription(policy),shippingHint:mode==='pickup'?'自取免运费':s.shippingProgress(q.subtotal,q.lines.length,policy).shippingHint,pickupEnabled:policy.pickupEnabled,pickupLocation:policy.pickupLocation,pickupHours:policy.pickupHours,pickupName:accepted?(this.data.pickupName||(a&&a.name)||''):'',pickupPhone:accepted?(this.data.pickupPhone||(a&&a.phone)||''):'',hasQuote:true,quoteReady:!q.shippingError&&q.total!==null,notice:changed?'商品价格已更新，请核对金额后提交。':''});
  }catch(e){if(ui.current(this,request)){this.quote=null;if(!consent.refresh(this))this.setData({address:null,pickupName:'',pickupPhone:''});this.setData({error:e.message||'暂时无法核对商品，请重试',quoteReady:false,hasQuote:false,total:'—',shipping:'—'})}}
  finally{if(ui.current(this,request))this.setData({loading:false})}
 },
 mode(e){const mode=e.currentTarget.dataset.mode;if(this.data.busy||this._createdOrder||!['delivery','pickup'].includes(mode)||mode===this.data.deliveryMode)return;this.setData({deliveryMode:mode});return this.reload()},
 field(e){if(!privacy.hasConsent()||this.data.busy)return;const key=e.currentTarget.dataset.field;if(['pickupName','pickupPhone'].includes(key))this.setData({[key]:e.detail.value})},
 address(){if(!this.data.busy&&!this._createdOrder)ui.navigate(this,'/pages/address/index?select=1')},
 browse(){if(!this.data.busy)ui.navigate(this,this.source==='cart'?'/pages/cart/index':'/pages/home/index','switchTab')},
 openOrder(){if(!this._createdOrder)return;if(this._viewHidden){this.setData({busy:false});return;}this.setData({busy:true});try{wx.redirectTo({url:'/pages/order/index?id='+encodeURIComponent(this._createdOrder.id),fail:()=>{this.setData({busy:false});s.err(new Error('订单已生成，请点击“查看订单”继续'))}})}catch(e){this.setData({busy:false});s.err(e)}},
 async submit(){
  if(this.data.busy)return;if(this._createdOrder)return this.openOrder();
  if(this.data.loading||!this.data.quoteReady||!this.quote)return;
  this.setData({busy:true});
  try{
   privacy.assertConsent();
   if(this.data.error||this.data.shippingError)throw new Error(this.data.error||this.data.shippingError);
   const options={promotionRevision:this.policy.revision||0,expectedTotal:this.quote.total,deliveryMode:this.data.deliveryMode,pickupContact:{name:this.data.pickupName,phone:this.data.pickupPhone}};
   d.validateFulfillment(options,this.data.address,this.policy,s.config.mode==='cloud');
   const o=await s.createOrder(this.items,this.data.address,this.token,options);this._createdOrder=o;this.setData({orderCreated:true});
   if(this.source==='cart'){const bought=new Map(this.quote.lines.map(l=>[l.skuId,l.qty]));s.saveCart(s.cart().map(i=>({...i,qty:i.qty-(bought.get(i.skuId)||0)})).filter(i=>i.qty>0))}
   wx.removeStorageSync('checkout.v1');this.openOrder();
  }catch(e){
   this.setData({busy:false});s.err(e);
   if(!privacy.hasConsent()){consent.refresh(this);this.setData({address:null,pickupName:'',pickupPhone:''})}
   if(!this._createdOrder&&/库存|下架|金额|折扣|价格|运费|配送|自取/.test(e.message||'')){await this.reload();if(this.data.quoteReady)this.setData({notice:'商品或配送信息已更新，请核对后重新提交。'})}
  }
 }
});
