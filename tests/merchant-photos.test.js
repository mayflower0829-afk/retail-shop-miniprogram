const test=require('node:test'),assert=require('node:assert/strict');
const storage=new Map(),files=new Map(),clone=x=>x===undefined?undefined:JSON.parse(JSON.stringify(x));
let menu=0,mediaCalls=0,privacyCalls=0;
global.wx={env:{USER_DATA_PATH:'/local-user-data'},getStorageSync:k=>clone(storage.get(k)),setStorageSync:(k,v)=>storage.set(k,clone(v)),removeStorageSync:k=>storage.delete(k),getAccountInfoSync:()=>({miniProgram:{envVersion:'develop'}}),showToast(){},navigateBack(){},showModal({success}){success({confirm:true})},showActionSheet({success}){success({tapIndex:menu})},requirePrivacyAuthorize({success}){privacyCalls++;success()},chooseMedia(options){mediaCalls++;assert.deepEqual(options.sizeType,['original']);assert.deepEqual(options.mediaType,['image']);options.success({tempFiles:[{tempFilePath:'/temporary/photo.png',size:25}]})},getFileSystemManager(){return {copyFile({srcPath,destPath,success}){files.set(destPath,srcPath);success()},unlink({filePath}){files.delete(filePath)}}}};
const s=require('../miniprogram/utils/store');s.config.mode='demo';s.config.demoAdminEnabled=true;require('../miniprogram/utils/runtime').initialize(s.config,wx);
function page(){let p;global.Page=value=>p=value;const path=require.resolve('../miniprogram/merchant/new-product/index.js');delete require.cache[path];require(path);p.data=clone(p.data);p.setData=function(v){Object.assign(this.data,clone(v))};p.onLoad({});return p}
const set=(p,field,value)=>p.field({currentTarget:{dataset:{field}},detail:{value}});
test('album photos use original quality, survive reopening and stay in the verified owner draft',async()=>{
 storage.clear();files.clear();const original={merchantIdentity:s.merchantIdentity,shippingPolicy:s.shippingPolicy,ensureAdmin:s.ensureAdmin};let owner='first-owner';
 s.merchantIdentity=async()=>({openid:owner});s.shippingPolicy=async()=>({promotion:{enabled:true,discountBps:8800,title:'全场8.8折'}});s.ensureAdmin=async()=>true;
 try{const p=page();await p.onShow();set(p,'name','未完成新品');set(p,'price','20.00');set(p,'stock','3');await p.photo();assert.equal(p.data.salePreview,'17.60');assert.equal(p.data.photos.length,1);const path=p.data.photos[0].path;assert.ok(files.has(path));assert.equal(mediaCalls,1);assert.equal(privacyCalls,1);p.onUnload();
  const restored=page();await restored.onShow();assert.equal(restored.data.name,'未完成新品');assert.equal(restored.data.photos[0].path,path);
  owner='second-owner';const separate=page();await separate.onShow();assert.equal(separate.data.name,'');assert.deepEqual(separate.data.photos,[]);
  owner='first-owner';await restored.discard();restored.onUnload();assert.ok(!files.has(path));assert.equal(storage.has('merchant.new-product.draft.v1.first-owner'),false);
 }finally{Object.assign(s,original)}
});
test('privacy authorization failure does not collect photos or discard the unfinished form',async()=>{
 storage.clear();const original={ensureAdmin:s.ensureAdmin,merchantIdentity:s.merchantIdentity};const authorize=wx.requirePrivacyAuthorize;
 s.ensureAdmin=async()=>true;s.merchantIdentity=async()=>({openid:'photo-owner'});wx.requirePrivacyAuthorize=({fail})=>fail({errMsg:'privacy denied'});
 try{const p=page();await p.onShow();set(p,'name','保留的商品名称');const before=mediaCalls;await p.photo();assert.equal(mediaCalls,before);assert.equal(p.data.name,'保留的商品名称');assert.equal(p.data.busy,false);assert.deepEqual(p.data.photos,[])}finally{Object.assign(s,original);wx.requirePrivacyAuthorize=authorize}
});
test('metadata loading retries after network failure and saves stable file IDs rather than temporary image URLs',async()=>{
 const original={merchantIdentity:s.merchantIdentity,shippingPolicy:s.shippingPolicy,adminProducts:s.adminProducts,updateProductInfo:s.updateProductInfo};let attempts=0,patch;
 s.merchantIdentity=async()=>({openid:'photo-owner'});s.shippingPolicy=async()=>({promotion:{enabled:false,discountBps:10000,title:'原价'}});
 s.adminProducts=async()=>{if(++attempts===1)throw new Error('暂时连接失败');return [{id:'saved-product',name:'有图商品',type:'吧唧',group:'明谷',active:true,gallery:['https://images.invalid/first','https://images.invalid/second'],galleryFileIDs:['cloud://mock-env.bucket/first','cloud://mock-env.bucket/second']}]};
 s.updateProductInfo=async(id,info)=>{patch=info;return {id,active:true}};
 try{const p=page();p.id='saved-product';await p.onShow();assert.equal(p.data.authorized,false);await p.onShow();assert.equal(p.data.editing,true);p.cover({currentTarget:{dataset:{index:1}}});await p.save();assert.deepEqual(patch.imageFileIDs,['cloud://mock-env.bucket/second','cloud://mock-env.bucket/first']);assert.equal(p.data.error,'')}
 finally{Object.assign(s,original)}
});
