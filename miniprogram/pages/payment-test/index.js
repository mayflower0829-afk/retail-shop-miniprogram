const s=require('../../utils/store'),privacy=require('../../utils/privacy'),consent=require('../../utils/consent-page');
Page({...consent.methods,
 data:{...consent.data,demo:false,authorized:false,ready:false,error:'',busy:false,acknowledged:false,consentTitle:'支付测试前，请先确认',consentPurpose:'用于通过你的微信身份创建支付测试订单、核对付款结果，不需要收货姓名、手机号或地址。',consentButton:'同意并继续'},
 onLoad(){this._unloaded=false;this.token=Date.now()+'_'+Math.random().toString(36).slice(2)},
 onShow(){return this.reload()},onConsentGranted(){return this.reload()},
 async reload(){
  if(this._unloaded)return;const generation=this.generation=(this.generation||0)+1;
  consent.refresh(this);this.setData({authorized:false,ready:false,error:''});
  try{await s.ensureAdmin();if(generation!==this.generation||this._unloaded)return;
   if(s.config.mode!=='cloud')throw new Error('支付测试需要连接真实云端店铺');
   const info=await s.cloud('runtime');if(generation!==this.generation||this._unloaded)return;
   this.setData({authorized:true,ready:info.paymentConfigured===true&&info.paymentTestEnabled===true,error:!info.paymentConfigured?'微信支付参数尚未配置':!info.paymentTestEnabled?'支付测试暂未开放':''})
  }catch(e){if(generation===this.generation&&!this._unloaded)this.setData({authorized:false,ready:false,error:e.message})}
 },
 onUnload(){this._unloaded=true;this.generation=(this.generation||0)+1;this.setData({authorized:false,ready:false,busy:false,acknowledged:false})},
 acknowledge(e){this.setData({acknowledged:Array.isArray(e.detail.value)&&e.detail.value.includes('test')})},
 async create(){if(this.data.busy||this._unloaded)return;this.setData({busy:true,error:''});try{privacy.assertConsent();if(!this.data.authorized||!this.data.ready)throw new Error('支付测试暂未就绪');if(!this.data.acknowledged)throw new Error('请先确认这是不发货的真实支付测试');const order=await s.createPaymentTestOrder(this.token);if(!this._unloaded)wx.redirectTo({url:'/pages/order/index?id='+order.id})}catch(e){if(!this._unloaded)this.setData({error:e.message})}finally{if(!this._unloaded)this.setData({busy:false})}}
});
