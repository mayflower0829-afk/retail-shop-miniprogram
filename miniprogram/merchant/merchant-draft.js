const fields=['name','price','stock','ip','description','skuName','groupIndex','typeIndex','active'];
function save(key,data,token,photos){if(!key)return;const value={fields:fields.reduce((v,k)=>{v[k]=data[k];return v},{}),token,photos,updatedAt:Date.now()};wx.setStorageSync(key,value)}
function load(key){const value=wx.getStorageSync(key);if(!value||!value.fields||!Array.isArray(value.photos)||value.photos.length>9)return null;return value}
function cachePhoto(file,token){
 if(!file||!file.size||file.size>8*1024*1024)throw new Error('商品图片需小于8MB');
 const match=(file.name||file.path||'').match(/\.(png|jpe?g|gif|webp)$/i),ext=match?match[1].toLowerCase():'jpg';
 const path=wx.env.USER_DATA_PATH+'/merchant-draft-'+token+'.'+ext;
 return new Promise((resolve,reject)=>wx.getFileSystemManager().copyFile({srcPath:file.path,destPath:path,success:()=>resolve({path,name:'商品图片.'+ext,size:file.size,token,cached:true,fileID:''}),fail:()=>reject(new Error('草稿图片保存失败，请重新选择'))}));
}
function remove(photo){if(!photo||!photo.cached||!wx.env||!photo.path.startsWith(wx.env.USER_DATA_PATH+'/merchant-draft-'))return;wx.getFileSystemManager().unlink({filePath:photo.path,fail(){}})}
function clear(key,photos=[],cleanup=true){if(key)wx.removeStorageSync(key);if(cleanup)photos.forEach(remove)}
module.exports={save,load,cachePhoto,remove,clear};
