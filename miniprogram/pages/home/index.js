const s=require('../../utils/store'),images=require('../../utils/product-images'),ui=require('../../utils/ui'),search=require('../../utils/search');
Page({
 data:{shopName:s.config.shopName,promotionTitle:s.config.promotion.title,shippingText:s.shippingDescription(s.config),demo:s.config.mode==='demo',visible:[],limit:20,filter:'全部',keyword:'',onlyStock:false,filters:['全部','收藏'],sort:'default',sortOptions:['综合','价格从低到高','价格从高到低'],loading:true,error:''},
 onShow(){ui.resume(this);const filter=wx.getStorageSync('home.filter.v1');if(filter){this.setData({filter,limit:20});wx.removeStorageSync('home.filter.v1')}return this.reload()},
 onHide(){ui.suspend(this)},onUnload(){ui.suspend(this)},
 async reload(){
  const request=ui.request(this);this.setData({loading:true,error:''});
  const history=Promise.resolve().then(()=>s.orders()).then(list=>list.filter(o=>['paid','shipped','ready_pickup','completed','refund_requested','refunded'].includes(o.status)).flatMap(o=>(o.lines||[]).map(l=>l.productId))).catch(()=>null);
  try{
   const policy=await s.shippingPolicy(),products=await s.catalog(policy);if(!ui.current(this,request))return;
   this.products=products;this.setData({promotionTitle:policy.promotion.title,shippingText:s.shippingDescription(policy),loading:false});this.applyFilters();
   const purchased=await history;if(!ui.current(this,request))return;if(purchased!==null){this.purchased=purchased;this.applyFilters()}
  }catch(e){if(ui.current(this,request)){this.setData({error:e.message});s.err(e)}}finally{if(ui.current(this,request))this.setData({loading:false})}
 },
 applyFilters(){const products=this.products||[],filters=['全部',...(products.some(p=>p.isNew)?['新品']:[]),...((this.purchased||[]).length?['买过']:[]),'收藏'];this.setData({filters,filter:filters.includes(this.data.filter)?this.data.filter:'全部'});this.apply()},
 apply(){let p=(this.products||[]).filter(search.matcher(this.data.keyword));if(this.data.filter==='新品')p=p.filter(x=>x.isNew);if(this.data.filter==='收藏'){const favorites=new Set(s.favorites());p=p.filter(x=>favorites.has(x.id))}if(this.data.filter==='买过'){const purchased=new Set(this.purchased||[]);p=p.filter(x=>purchased.has(x.id))}if(this.data.onlyStock)p=p.filter(x=>x.stock>0);p=s.sortProducts(p,this.data.sort);this.setData({filtersActive:!!this.data.keyword.trim()||this.data.filter!=='全部'||this.data.onlyStock||this.data.sort!=='default',resultCount:p.length,visible:p.slice(0,this.data.limit),hasMore:p.length>this.data.limit})},
 more(){ui.cancelSearch(this);this.setData({limit:this.data.limit+20});this.apply()},
 search(e){this.setData({keyword:e.detail.value,limit:20});ui.defer(this,()=>this.apply())},
 filter(e){ui.cancelSearch(this);this.setData({filter:e.currentTarget.dataset.value,limit:20});this.apply()},
 stock(e){ui.cancelSearch(this);this.setData({onlyStock:e.detail.value});this.apply()},
 sort(e){ui.cancelSearch(this);this.setData({sort:['default','asc','desc'][Number(e.detail.value)],sortIndex:Number(e.detail.value),limit:20});this.apply()},
 category(e){if(this._navigating)return;wx.setStorageSync('category.preference.v1',{group:e.currentTarget.dataset.group||'全部',type:e.currentTarget.dataset.type||'全部'});ui.navigate(this,'/pages/category/index','switchTab')},
 onReachBottom(){if(this.data.hasMore)this.more()},
 confirmSearch(){ui.cancelSearch(this);this.setData({limit:20});this.apply()},
 clearSearch(){ui.cancelSearch(this);this.setData({keyword:'',limit:20});this.apply()},
 resetFilters(){ui.cancelSearch(this);this.setData({keyword:'',filter:'全部',onlyStock:false,sort:'default',sortIndex:0,limit:20});this.apply()},
 quickAdd(e){try{const p=(this.products||[]).find(p=>p.id===e.currentTarget.dataset.id);if(!s.quickAdd(p))return this.detail(e);wx.showToast({title:'已加入购物车',icon:'success',duration:1200})}catch(e){s.err(e)}},
 preview(e){images.openPreview(e.currentTarget.dataset.id,this)},
 detail(e){ui.navigate(this,images.detailUrl(e.currentTarget.dataset.id))}
});
