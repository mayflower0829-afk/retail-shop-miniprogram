const resolver=require('../../utils/legacy-image-resolver');
Component({
 properties:{src:{type:String,value:'',observer:'sourceChanged'},mode:{type:String,value:'aspectFit'}},
 data:{frames:[],state:'empty'},
 lifetimes:{attached(){this._detached=false;if(this._source!==this.properties.src)this.sourceChanged(this.properties.src)},detached(){this._detached=true;this._imageKey=(this._imageKey||0)+1}},
 methods:{
  sourceChanged(src){if(src===this._source)return;this._source=src;this.load(src)},
  load(src,force=false){const key=this._imageKey=(this._imageKey||0)+1,empty=!src||src.endsWith('placeholder.jpg');
   if(empty){this.setData({frames:[],state:'empty'});return}
   if(!resolver.migrated(src)){this.setData({frames:[{src,key}],state:'loading'});return}
   this.setData({frames:[],state:'loading'});
   resolver.resolve(src,{force}).then(url=>{if(!this._detached&&key===this._imageKey)this.setData({frames:[{src:url,key}]})},()=>{if(!this._detached&&key===this._imageKey){this.setData({state:'failed'});if(this.triggerEvent)this.triggerEvent('error',{})}});
  },
  loaded(e){this.settle(e,'loaded')},failed(e){this.settle(e,'failed')},
  settle(e,state){if(!this._detached&&Number(e.currentTarget.dataset.key)===this._imageKey&&this.data.state==='loading'){this.setData({state});if(this.triggerEvent)this.triggerEvent(state==='loaded'?'load':'error',e.detail||{})}},
  retry(){if(this.data.state==='failed')this.load(this.properties.src,true)}
 }
});
