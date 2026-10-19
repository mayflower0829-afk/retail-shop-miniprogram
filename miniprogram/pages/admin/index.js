const s=require('../../utils/store');
const emptyFulfillment=()=>({fulfillmentId:'',carrier:'',tracking:'',pickupCode:'',carrierCode:'',carrierIndex:-1});
const emptyManagement=()=>({orders:[],authorized:false,loading:false,checking:false,hasMore:false,hasDeliveryToShip:false,hasPickupToRedeem:false,paymentTestEnabled:false,overview:null,overviewError:'',paymentStatus:'',...emptyFulfillment()});
Page({
 data:{...emptyManagement(),error:'',demo:s.config.mode==='demo',busy:false,status:'all',keyword:'',searchText:'',deliveryMode:'all',deliveryOptions:[{id:'all',name:'全部订单'},{id:'delivery',name:'快递配送'},{id:'pickup',name:'到店自取'}],tabs:[{id:'all',name:'全部'},{id:'pending',name:'待付款'},{id:'paid',name:'待发货/备货'},{id:'shipped',name:'已发货'},{id:'ready_pickup',name:'待自取'},{id:'completed',name:'已完成'},{id:'cancelled',name:'已取消'},{id:'refund_requested',name:'售后待处理'}],carriers:[]},
 onShow(){this._unloaded=false;this._hidden=false;if(this.data.busy){this._resumePending=true;return}return this.reload()},
 async finishAction(){this.setData({busy:false});if(this._resumePending){this._resumePending=false;if(!this._hidden&&!this._unloaded)await this.reload()}},
 current(generation){return !this._unloaded&&!this._hidden&&generation===this.generation},
 async reload(options={}){
  if(this._unloaded||this._hidden||this.data.busy&&!options.afterAction)return;
  const generation=this.generation=(this.generation||0)+1;this.offset=0;this.cursor=null;
  this.setData({...emptyManagement(),checking:true,error:''});
  try{await s.ensureAdmin();if(!this.current(generation))return;this.setData({authorized:true,checking:false});await this.load(generation);
   if(!this.current(generation)||!this.data.authorized)return;
   try{const overview=await s.merchantOverview();if(this.current(generation))this.setData({overview:{...overview,paidText:s.money(overview.paidCents),refundedText:s.money(overview.refundedCents)},overviewError:''})}catch(e){if(this.current(generation))this.setData({overview:null,overviewError:e.message})}
   if(!this.current(generation)||!this.data.authorized)return;
   if(!this.data.demo){try{const info=await s.cloud('runtime');if(!this.current(generation))return;this.setData({paymentTestEnabled:false,paymentStatus:info.paymentConfigured?'微信收款参数已配置':'微信收款参数尚未配置'});const carriers=await s.cloud('shippingCarriers');if(this.current(generation))this.setData({carriers:Array.isArray(carriers)?carriers:[]})}catch(e){if(this.current(generation))this.setData({paymentStatus:'收款状态暂未核对，请重试'})}}
  }catch(e){if(this.current(generation))this.setData({...emptyManagement(),error:e.message})}
 },
 async load(generation){if(!this.current(generation)||this.data.loading||!this.data.authorized)return;this.setData({loading:true});try{
  const page=await s.adminOrderPage({offset:this.data.demo?this.offset||0:0,cursor:this.data.demo?null:this.cursor,status:this.data.status,deliveryMode:this.data.deliveryMode,keyword:this.data.keyword});if(!this.current(generation))return;
  const added=page.orders.map(o=>s.orderSummary(o,s.orderStatusName(o))),orders=[...this.data.orders,...added.filter(o=>!this.data.orders.some(x=>x.id===o.id))];this.offset=page.nextOffset;this.cursor=page.nextCursor||null;
  this.setData({orders,hasMore:page.hasMore,hasDeliveryToShip:orders.some(o=>o.kind!=='payment_test'&&o.status==='paid'&&o.deliveryMode!=='pickup'),hasPickupToRedeem:orders.some(o=>o.kind!=='payment_test'&&o.status==='ready_pickup'),error:''});
 }catch(e){if(this.current(generation)){this.offset=0;this.cursor=null;this.setData({...emptyManagement(),error:e.message})}}finally{if(this.current(generation))this.setData({loading:false})}},
 onHide(){this._hidden=true;this.generation=(this.generation||0)+1;this.cursor=null;this.offset=0;this.setData(emptyManagement())},
 onUnload(){this._unloaded=true;this.onHide()},
 more(){return this.load(this.generation)},onReachBottom(){if(this.data.hasMore)return this.more()},
 searchInput(e){if(!this.data.busy)this.setData({searchText:e.detail.value})},
 search(){if(this.data.busy)return;this.setData({keyword:this.data.searchText.trim()});return this.reload()},
 deliveryFilter(e){if(this.data.busy)return;this.setData({deliveryMode:e.currentTarget.dataset.id});return this.reload()},
 summaryFilter(e){if(this.data.busy)return;this.setData({status:e.currentTarget.dataset.status,deliveryMode:e.currentTarget.dataset.mode||'all',keyword:'',searchText:''});return this.reload()},
 filter(e){if(this.data.busy)return;this.setData({status:e.currentTarget.dataset.id});return this.reload()},
 beginFulfillment(e){
  if(this.data.busy||!this.data.authorized)return;const id=e.currentTarget.dataset.id,o=this.data.orders.find(o=>o.id===id);
  if(!o||o.kind==='payment_test'||!(o.status==='paid'&&o.deliveryMode!=='pickup'||o.status==='ready_pickup'&&o.deliveryMode==='pickup'))return;
  this.setData({...emptyFulfillment(),fulfillmentId:id});
 },
 closeFulfillment(){if(!this.data.busy)this.setData(emptyFulfillment())},
 field(e){if(this.data.busy||!this.data.fulfillmentId)return;const field=e.currentTarget.dataset.field;if(['carrier','tracking','pickupCode'].includes(field))this.setData({[field]:e.detail.value})},
 carrierChange(e){if(this.data.busy||!this.data.fulfillmentId)return;const index=Number(e.detail.value),carrier=this.data.carriers[index];if(carrier)this.setData({carrierIndex:index,carrier:carrier.name,carrierCode:carrier.id})},
 async ship(e){
  if(this.data.busy||!this.data.authorized)return;const id=e.currentTarget.dataset.id,o=this.data.orders.find(o=>o.id===id),generation=this.generation;
  if(id!==this.data.fulfillmentId||!o||o.kind==='payment_test'||o.status!=='paid'||o.deliveryMode==='pickup')return;
  const payload={carrier:this.data.carrier.trim(),tracking:this.data.tracking.trim(),carrierCode:this.data.carrierCode};
  if(!payload.carrier||!this.data.demo&&!payload.carrierCode)return s.err(new Error('请选择快递公司'));
  if(!payload.tracking)return s.err(new Error('请填写这笔订单的快递单号'));
  this.setData({busy:true});try{await s.ensureAdmin();if(!this.current(generation))return;const order=await s.action(id,'ship',payload);if(!this.current(generation))return;await this.reload({afterAction:true});if(!this._hidden&&!this._unloaded&&order&&order.wechatShippingError)s.err(new Error(order.wechatShippingError))}catch(e){if(this.current(generation))s.err(e)}finally{await this.finishAction()}
 },
 async pickup(e){
  if(this.data.busy||!this.data.authorized)return;const {id,action}=e.currentTarget.dataset,o=this.data.orders.find(o=>o.id===id),generation=this.generation;
  if(!o||o.kind==='payment_test'||o.deliveryMode!=='pickup'||!['preparePickup','completePickup'].includes(action))return;
  if(action==='preparePickup'&&o.status!=='paid'||action==='completePickup'&&(o.status!=='ready_pickup'||id!==this.data.fulfillmentId))return;
  const payload={pickupCode:this.data.pickupCode.trim()};if(action==='completePickup'&&!/^\d{6}$/.test(payload.pickupCode))return s.err(new Error('请填写顾客出示的6位自取码'));
  this.setData({busy:true});try{await s.ensureAdmin();if(!this.current(generation))return;await s.action(id,action,payload);if(this.current(generation))await this.reload({afterAction:true})}catch(e){if(this.current(generation))s.err(e)}finally{await this.finishAction()}
 },
 async syncShipping(e){if(this.data.busy||!this.data.authorized)return;const id=e.currentTarget.dataset.id,generation=this.generation;this.setData({busy:true});try{await s.ensureAdmin();if(!this.current(generation))return;await s.cloud('syncShipping',{id});if(this.current(generation))await this.reload({afterAction:true})}catch(e){if(this.current(generation))s.err(e)}finally{await this.finishAction()}},
 async go(url){if(this.data.busy||this._opening)return;this._opening=true;try{await s.ensureAdmin();if(!this._hidden&&!this._unloaded)wx.navigateTo({url})}catch(e){s.err(e)}finally{this._opening=false}},
 products(){return this.go('/pages/admin-products/index')},settings(){return this.go('/merchant/settings/index')},exportData(){return this.go('/merchant/export/index')},
 open(e){if(this.data.authorized&&!this.data.busy)wx.navigateTo({url:'/pages/order/index?id='+encodeURIComponent(e.currentTarget.dataset.id)})}
});
