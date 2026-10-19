const s=require('../../utils/store'),images=require('../../utils/product-images'),ui=require('../../utils/ui'),search=require('../../utils/search');
Page({
 data:{catalogScrollTop:0,visible:[],ips:[],types:['全部','吧唧','立牌','卡片','挂件','盲盒','其他周边'],ip:'全部',limit:20,type:'全部',group:'全部',groups:['全部','明谷','盲盒'],keyword:'',error:'',loading:true},
 onShow(){ui.resume(this);const preference=wx.getStorageSync('category.preference.v1');if(preference){this.setData({...preference,ip:'全部',limit:20});wx.removeStorageSync('category.preference.v1');this._resetOnLoad=true}return this.reload()},
 onHide(){this._scrollReset=(this._scrollReset||0)+1;ui.suspend(this)},onUnload(){this.onHide()},
 async reload(){const request=ui.request(this);this.setData({loading:true,error:''});try{const p=await s.catalog();if(!ui.current(this,request))return;this.products=p;this.setData({ips:['全部',...new Set(p.map(x=>x.ip))]});this.apply(!!this._resetOnLoad);this._resetOnLoad=false}catch(e){if(ui.current(this,request)){this.setData({error:e.message});s.err(e)}}finally{if(ui.current(this,request))this.setData({loading:false})}},
 scrolled(e){this._catalogScrollTop=Math.max(0,Number(e.detail.scrollTop)||0)},
 apply(resetScroll=false){const scrollRequest=resetScroll?this._scrollReset=(this._scrollReset||0)+1:0,matches=search.matcher(this.data.keyword),filtered=s.sortProducts((this.products||[]).filter(p=>(this.data.ip==='全部'||p.ip===this.data.ip)&&(this.data.type==='全部'||p.type===this.data.type)&&(this.data.group==='全部'||p.group===this.data.group)&&matches(p)));this.setData({filtersActive:!!this.data.keyword.trim()||this.data.ip!=='全部'||this.data.type!=='全部'||this.data.group!=='全部',resultCount:filtered.length,visible:ui.catalogCards(filtered.slice(0,this.data.limit)),hasMore:filtered.length>this.data.limit,...(resetScroll?{catalogScrollTop:this._catalogScrollTop||1}:{})},resetScroll?()=>{if(this._viewHidden||this._scrollReset!==scrollRequest)return;this._catalogScrollTop=0;this.setData({catalogScrollTop:0})}:undefined)},
 ip(e){ui.cancelSearch(this);this.setData({ip:e.currentTarget.dataset.value,limit:20});this.apply(true)},
 group(e){ui.cancelSearch(this);this.setData({group:e.currentTarget.dataset.value,limit:20});this.apply(true)},
 type(e){ui.cancelSearch(this);this.setData({type:e.currentTarget.dataset.value,limit:20});this.apply(true)},
 more(){ui.cancelSearch(this);this.setData({limit:this.data.limit+20});this.apply()},
 search(e){this.setData({keyword:e.detail.value,limit:20});ui.defer(this,()=>this.apply(true))},
 confirmSearch(){ui.cancelSearch(this);this.setData({limit:20});this.apply(true)},
 clearSearch(){ui.cancelSearch(this);this.setData({keyword:'',limit:20});this.apply(true)},
 resetFilters(){ui.cancelSearch(this);this.setData({keyword:'',ip:'全部',type:'全部',group:'全部',limit:20});this.apply(true)},
 quickAdd(e){try{const p=(this.products||[]).find(p=>p.id===e.currentTarget.dataset.id);if(!s.quickAdd(p))return this.detail(e);wx.showToast({title:'已加入购物车',icon:'success',duration:1200})}catch(e){s.err(e)}},
 preview(e){images.openPreview(e.currentTarget.dataset.id,this)},detail(e){ui.navigate(this,images.detailUrl(e.currentTarget.dataset.id))}
});
