const s=require('../../utils/store'),ui=require('../../utils/ui');
Page({
 data:{orders:[],visible:[],status:'all',tabs:[{id:'all',name:'全部'},{id:'pending',name:'待付款'},{id:'paid',name:'待发货/备货'},{id:'shipped',name:'待收货'},{id:'ready_pickup',name:'待自取'},{id:'completed',name:'已完成'}],error:'',loading:true,hasMore:false},
 onShow(){ui.resume(this);const filter=wx.getStorageSync('orders.filter.v1'),changed=filter&&filter!==this.data.status;if(filter){this.setData({status:filter});wx.removeStorageSync('orders.filter.v1')}return this.reload({clear:!!changed})},
 onHide(){ui.suspend(this)},onUnload(){ui.suspend(this)},
 async reload(options={}){this.generation=ui.request(this);this.offset=0;this.setData({...(options.clear?{orders:[],visible:[]}:{}),error:'',hasMore:false});await this.load(this.generation,true)},
 async load(generation,replace=false){
  if(!ui.current(this,generation)||this.data.loading&&this._loadingRequest===generation)return;
  this._loadingRequest=generation;this.setData({loading:true});
  try{const page=await s.orderPage({offset:this.offset||0,status:this.data.status});if(!ui.current(this,generation))return;
   const added=page.orders.map(o=>({...o,statusName:s.orderStatusName(o),totalText:s.money(o.total),dateText:new Date(o.createdAt).toLocaleDateString(),preview:o.lines.slice(0,2).map(l=>({...l,displayName:s.lineTitle(l)})),extraCount:Math.max(0,o.lines.length-2)})),orders=replace?added:[...this.data.orders,...added.filter(o=>!this.data.orders.some(x=>x.id===o.id))];
   this.offset=page.nextOffset;this.setData({orders,visible:orders,hasMore:page.hasMore,error:''});
  }catch(e){if(ui.current(this,generation))this.setData({error:e.message})}finally{if(ui.current(this,generation))this.setData({loading:false})}
 },
 more(){return this.load(this.generation)},onReachBottom(){if(this.data.hasMore)return this.more()},apply(){this.setData({visible:this.data.orders})},
 filter(e){const status=e.currentTarget.dataset.id;if(status===this.data.status)return;this.setData({status});return this.reload({clear:true})},
 open(e){ui.navigate(this,'/pages/order/index?id='+encodeURIComponent(e.currentTarget.dataset.id))},browse(){ui.navigate(this,'/pages/home/index','switchTab')}
});
