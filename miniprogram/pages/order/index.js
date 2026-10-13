const s=require('../../utils/store');
Page({data:{o:null,total:'',discount:'',status:'',error:'',busy:false,canPay:false,canCancel:false,canReceive:false},onLoad(q){this._unloaded=false;this.id=q.id},async onShow(){if(this._awaitingWechatReceipt){this._awaitingWechatReceipt=false;try{await s.action(this.id,'receive')}catch(e){}}return this.reload()},
 async reload(){
  if(this._unloaded)return;const generation=this.generation=(this.generation||0)+1;
  this.setData({canPay:false,canCancel:false,canReceive:false,error:''});
  try{const o=await s.order(this.id);if(generation!==this.generation||this._unloaded)return;if(!o)throw new Error('订单不存在');const local=s.config.mode==='demo';
   this.setData({o:{...o,lines:(o.lines||[]).map(l=>({...l,displayName:s.lineTitle(l)}))},total:s.money(o.total),discount:s.money(o.discountAmount||0),status:s.orderStatusName(o),date:new Date(o.createdAt).toLocaleString(),step:o.kind==='payment_test'?-1:['pending','paid','shipped','completed'].indexOf(o.status),canPay:local?o.status==='pending':o.canPay===true,canCancel:local?o.status==='pending':o.canCancel===true,canReceive:local?o.status==='shipped':o.canReceive===true,error:''})
  }catch(e){if(generation===this.generation&&!this._unloaded)this.setData({o:null,canPay:false,canCancel:false,canReceive:false,error:e.message})}
 },
 onUnload(){this._unloaded=true;this.generation=(this.generation||0)+1;this.setData({o:null,busy:false,canPay:false,canCancel:false,canReceive:false})},
 async pay(){if(this.data.busy||!this.data.canPay||this._unloaded)return;this.setData({busy:true});try{await s.pay(this.data.o)}catch(e){if(!this._unloaded)s.err(e)}finally{if(!this._unloaded){await this.reload();this.setData({busy:false})}}},
 async operate(e){
  if(this.data.busy||this._unloaded)return;const type=e.currentTarget.dataset.action;
  if(!['cancel','receive'].includes(type)||type==='cancel'&&!this.data.canCancel||type==='receive'&&!this.data.canReceive)return;
  this.setData({busy:true});
  try{const r=await new Promise((resolve,reject)=>wx.showModal({title:type==='cancel'?'取消订单':'确认已收货',content:'请确认要继续此操作。',success:resolve,fail:()=>reject(new Error('确认窗口未能打开，请重试'))}));
   if(!r.confirm||this._unloaded)return;
   if(type==='receive'&&this.data.o&&this.data.o.usesWechatReceipt){
    if(typeof wx.openBusinessView!=='function')throw new Error('请升级微信后确认收货');
    if(!this.data.o.transactionId)throw new Error('订单缺少微信交易信息，请联系店主');
    this._awaitingWechatReceipt=true;
    wx.openBusinessView({businessType:'weappOrderConfirm',extraData:{transaction_id:this.data.o.transactionId},fail:()=>{this._awaitingWechatReceipt=false;if(!this._unloaded)s.err(new Error('微信确认收货暂时无法打开，请稍后重试'))}});return;
   }
   await s.action(this.id,type);if(!this._unloaded)await this.reload();
  }catch(e){if(!this._unloaded)s.err(e)}finally{if(!this._unloaded)this.setData({busy:false})}
 },
 contact(){wx.navigateTo({url:'/pages/help/index?orderId='+encodeURIComponent(this.id)})},
 async sync(){if(this.data.busy||this._unloaded)return;this.setData({busy:true});try{if(s.config.mode==='cloud')await s.cloud('syncPayment',{id:this.id});if(!this._unloaded)await this.reload()}catch(e){if(!this._unloaded)s.err(e)}finally{if(!this._unloaded)this.setData({busy:false})}},copy(){if(this.data.o&&this.data.o.tracking)wx.setClipboardData({data:this.data.o.tracking})}
});
