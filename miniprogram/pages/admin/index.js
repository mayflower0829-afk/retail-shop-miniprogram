const s=require('../../utils/store');
const emptyManagement=()=>({orders:[],authorized:false,loading:false,hasMore:false,hasDeliveryToShip:false,hasPickupToRedeem:false,paymentTestEnabled:false,paymentStatus:'',carrier:'',tracking:'',pickupCode:'',carrierCode:'',carrierIndex:-1});
Page({
 data:{orders:[],error:'',authorized:false,demo:s.config.mode==='demo',carrier:'',tracking:'',pickupCode:'',busy:false,loading:false,hasMore:false,status:'all',tabs:[{id:'all',name:'全部'},{id:'pending',name:'待付款'},{id:'paid',name:'待发货/备货'},{id:'shipped',name:'已发货'},{id:'ready_pickup',name:'待自取'},{id:'completed',name:'已完成'}],paymentStatus:'',paymentTestEnabled:false,carriers:[],carrierCode:'',carrierIndex:-1},
 onShow(){this._unloaded=false;return this.reload()},
 async reload(){
  if(this._unloaded)return;
  const generation=this.generation=(this.generation||0)+1;this.offset=0;this.cursor=null;
  this.setData({...emptyManagement(),error:''});
  try{await s.ensureAdmin();if(generation!==this.generation)return;this.setData({authorized:true});await this.load(generation);
   if(generation!==this.generation||!this.data.authorized)return;
   if(!this.data.demo){try{const info=await s.cloud('runtime');if(generation!==this.generation)return;this.setData({paymentTestEnabled:false,paymentStatus:info.paymentConfigured?'微信收款参数已配置':'微信收款参数尚未配置'});const carriers=await s.cloud('shippingCarriers');if(generation===this.generation)this.setData({carriers})}catch(e){if(generation===this.generation)this.setData({paymentStatus:'收款状态暂未核对，请重试'})}}
  }catch(e){if(generation===this.generation)this.setData({...emptyManagement(),error:e.message})}
 },
 async load(generation){if(this._unloaded||generation!==this.generation||this.data.loading||!this.data.authorized)return;this.setData({loading:true});try{
  const page=await s.adminOrderPage({offset:this.data.demo?this.offset||0:0,cursor:this.data.demo?null:this.cursor,status:this.data.status});if(generation!==this.generation)return;
  const added=page.orders.map(o=>s.orderSummary(o,s.orderStatusName(o)));const orders=[...this.data.orders,...added.filter(o=>!this.data.orders.some(x=>x.id===o.id))];this.offset=page.nextOffset;this.cursor=page.nextCursor||null;
  this.setData({orders,hasMore:page.hasMore,hasDeliveryToShip:orders.some(o=>o.kind!=='payment_test'&&o.status==='paid'&&o.deliveryMode!=='pickup'),hasPickupToRedeem:orders.some(o=>o.kind!=='payment_test'&&o.status==='ready_pickup'),error:''})
 }catch(e){if(generation===this.generation){this.offset=0;this.cursor=null;this.setData({...emptyManagement(),error:e.message})}}finally{if(generation===this.generation)this.setData({loading:false})}},
 onUnload(){this._unloaded=true;this.generation=(this.generation||0)+1;this.cursor=null;this.offset=0;this.setData(emptyManagement())},
 more(){return this.load(this.generation)},onReachBottom(){if(this.data.hasMore)return this.more()},
 filter(e){this.setData({status:e.currentTarget.dataset.id});return this.reload()},
 field(e){const field=e.currentTarget.dataset.field;if(['carrier','tracking','pickupCode'].includes(field))this.setData({[field]:e.detail.value})},
 async ship(e){if(this.data.busy)return;this.setData({busy:true});try{await s.ensureAdmin();const order=await s.action(e.currentTarget.dataset.id,'ship',{carrier:this.data.carrier,tracking:this.data.tracking.trim(),carrierCode:this.data.carrierCode});this.setData({tracking:''});await this.reload();if(order.wechatShippingError)s.err(new Error(order.wechatShippingError))}catch(e){s.err(e)}finally{this.setData({busy:false})}},
 async pickup(e){if(this.data.busy)return;this.setData({busy:true});try{await s.ensureAdmin();await s.action(e.currentTarget.dataset.id,e.currentTarget.dataset.action,{pickupCode:this.data.pickupCode.trim()});this.setData({pickupCode:''});await this.reload()}catch(e){s.err(e)}finally{this.setData({busy:false})}},
 async products(){try{await s.ensureAdmin();wx.navigateTo({url:'/pages/admin-products/index'})}catch(e){s.err(e)}},
 async settings(){try{await s.ensureAdmin();wx.navigateTo({url:'/merchant/settings/index'})}catch(e){s.err(e)}},
 carrierChange(e){const index=Number(e.detail.value),carrier=this.data.carriers[index];if(carrier)this.setData({carrierIndex:index,carrier:carrier.name,carrierCode:carrier.id})},
 async syncShipping(e){if(this.data.busy)return;this.setData({busy:true});try{await s.ensureAdmin();await s.cloud('syncShipping',{id:e.currentTarget.dataset.id});await this.reload()}catch(e){s.err(e)}finally{this.setData({busy:false})}},
 open(e){if(this.data.authorized)wx.navigateTo({url:'/pages/order/index?id='+e.currentTarget.dataset.id})}
});
