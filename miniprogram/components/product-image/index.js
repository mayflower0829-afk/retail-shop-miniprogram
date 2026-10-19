Component({
 properties:{src:{type:String,value:'',observer:'sourceChanged'}},
 data:{frames:[],state:'empty'},
 methods:{
  sourceChanged(src){if(src===this._source)return;this._source=src;this.load(src)},
  load(src){const key=this._imageKey=(this._imageKey||0)+1,empty=!src||src.endsWith('placeholder.jpg');this.setData({frames:empty?[]:[{src,key}],state:empty?'empty':'loading'})},
  loaded(e){this.settle(e,'loaded')},
  failed(e){this.settle(e,'failed')},
  settle(e,state){if(Number(e.currentTarget.dataset.key)===this._imageKey&&this.data.state==='loading')this.setData({state})},
  retry(){if(this.data.state==='failed')this.load(this.properties.src)}
 }
});
