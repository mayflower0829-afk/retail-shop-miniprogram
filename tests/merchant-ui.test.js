const test=require('node:test'),assert=require('node:assert/strict');
const storage=new Map(),clone=x=>x===undefined?undefined:JSON.parse(JSON.stringify(x));
global.wx={getStorageSync:k=>clone(storage.get(k)),setStorageSync:(k,v)=>storage.set(k,clone(v)),removeStorageSync:k=>storage.delete(k),getAccountInfoSync:()=>({miniProgram:{envVersion:'develop'}}),showToast(){},navigateBack(){},navigateTo(){}};
const s=require('../miniprogram/utils/store'),privacy=require('../miniprogram/utils/privacy');
s.config.mode='demo';s.config.cloudEnv='';s.config.demoAdminEnabled=true;require('../miniprogram/utils/runtime').initialize(s.config,wx);
function page(file){let p;global.Page=value=>p=value;const key=require.resolve('../miniprogram/'+file);delete require.cache[key];require(key);p.data=clone(p.data);p.setData=function(value){Object.assign(this.data,clone(value))};return p;}
test('shop manager can enter an arbitrary decimal discount and customer prices follow it while old orders stay frozen',async()=>{
 storage.clear();privacy.acceptConsent(true);const address={name:'测试',phone:'13900000000',region:['北京','北京','东城'],detail:'测试地址一号'};
 const original=(await s.catalog())[0],old=await s.createOrder([{skuId:original.skus[0].id,qty:1}],address,'saved-order-discount');
 const settings=page('merchant/settings/index.js');await settings.load();settings.field({detail:{value:'8.85'}});assert.equal(settings.data.preview,'全场8.85折');assert.equal(settings.data.examplePrice,'88.50');await settings.save();
 const catalog=await s.catalog();assert.equal(catalog[0].promotionTitle,'全场8.85折');assert.equal(catalog[0].skus[0].salePrice,require('../miniprogram/utils/domain').salePrice(catalog[0].skus[0].price,{enabled:true,discountBps:8850}));assert.deepEqual(await s.order(old.id),old);
 settings.field({detail:{value:'10'}});await settings.save();assert.equal((await s.catalog())[0].hasDiscount,false);
 s.config.demoAdminEnabled=false;await settings.load();assert.equal(settings.data.authorized,false);assert.equal(settings.data.discount,'');s.config.demoAdminEnabled=true;
});
test('all selling screens obtain one consistent promotion policy and expose the current title',async()=>{
 const originals={catalog:s.catalog,shippingPolicy:s.shippingPolicy,orders:s.orders};let calls=0;
 const policy={promotion:{enabled:true,discountBps:8888,title:'全场8.888折'},freeShipping:6900,shippingFee:500,pickupEnabled:true,revision:12};
 const product={id:'demo-product',name:'示例商品',displayName:'示例商品',ip:'示例',type:'吧唧',active:true,image:'/assets/placeholder.jpg',gallery:[],stock:3,hasDiscount:true,promotionTitle:policy.promotion.title,skus:[{id:'demo-sku',name:'默认款',price:1000,salePrice:889,stock:3}]};
 s.shippingPolicy=async()=>{calls++;return policy};s.catalog=async supplied=>{assert.strictEqual(supplied,policy);return [product]};s.orders=async()=>[];
 try{
  const home=page('pages/home/index.js');await home.reload();assert.equal(home.data.promotionTitle,policy.promotion.title);
  s.saveCart([{skuId:'demo-sku',qty:1,selected:true}]);const cart=page('pages/cart/index.js');await cart.reload();assert.equal(cart.data.total,'8.89');
  const detail=page('pages/detail/index.js');detail.id=product.id;await detail.reload();assert.equal(detail.data.p.promotionTitle,policy.promotion.title);
  const checkout=page('pages/checkout/index.js');checkout.items=[{skuId:'demo-sku',qty:1}];await checkout.reload();assert.equal(checkout.data.total,'13.89');assert.equal(checkout.data.promotionTitle,policy.promotion.title);assert.equal(calls,4);
 }finally{Object.assign(s,originals);}
});
test('new-product form accepts minimal shop data and preserves a missing-photo product as an editable draft',async()=>{
 storage.clear();const p=page('merchant/new-product/index.js');p.onLoad({});await p.onShow();
 for(const [field,value] of [['name','测试新品'],['price','12.30'],['stock','5']])p.field({currentTarget:{dataset:{field}},detail:{value}});
 await p.save();assert.equal(p.data.error,'');const products=await s.adminProducts(),added=products.find(x=>x.name==='测试新品');assert.ok(added);assert.equal(added.active,false);assert.equal(added.skus[0].price,1230);assert.equal(added.skus[0].stock,5);assert.ok(!(await s.catalog()).some(x=>x.id===added.id));
});
