const crypto = require('crypto');
const drafts = require('./product-draft');
const { missing } = require('./shop-settings');
const ACTIONS = new Set(['prepareProductFile', 'createProduct', 'updateProductInfo', 'previewProductImport', 'commitProductImport', 'getProductImportTemplate']);
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function token(value) { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{8,80}$/.test(value)) throw new Error('保存标识无效'); return value; }
function folder(openid, purpose) { return 'merchant-' + purpose + '/' + hash(openid).slice(0, 32) + '/'; }
function filePath(openid, purpose, key, ext) { return folder(openid, purpose) + hash(openid + ':' + token(key)) + '.' + ext; }
function verifyFileID(fileID, openid, purpose, envId) {
  if (typeof fileID !== 'string' || fileID.length > 500 || !/^cloud:\/\/[A-Za-z0-9_.-]+\//.test(fileID) || fileID.includes('..')) throw new Error('请使用本店上传的文件');
  if (envId && !fileID.startsWith('cloud://' + envId + '.')) throw new Error('文件不属于本店云环境');
  const path = fileID.slice(fileID.indexOf('/', 8) + 1);
  if (!path.startsWith(folder(openid, purpose)) || !/^[a-f0-9]{64}\.(xlsx|jpg|jpeg|png|gif|webp)$/.test(path.slice(folder(openid, purpose).length))) throw new Error('文件上传身份不匹配');
  return fileID;
}
function imageExtension(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > 8 * 1024 * 1024) throw new Error('图片需小于8MB');
  if (buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'png';
  if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return 'jpg';
  if (/^GIF8[79]a$/.test(buffer.subarray(0, 6).toString())) return 'gif';
  if (buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP') return 'webp';
  throw new Error('请选择PNG、JPG、GIF或WebP商品图片');
}
async function maybeGet(ref) { try { return (await ref.get()).data || null; } catch (error) { if (missing(error)) return null; throw error; } }
function publicProduct(product) { const { _createdBy, _creationSignature, ...result } = product; return result; }
async function image(cloud, fileID, openid, envId) {
  if (!fileID) return '';
  verifyFileID(fileID, openid, 'image', envId);
  const downloaded = await cloud.downloadFile({ fileID }); imageExtension(downloaded.fileContent);
  return fileID;
}
async function create(db, draft, images, openid, key) {
  const gallery=Array.isArray(images)?images:images?[images]:[];
  if(gallery.length>9||gallery.some(x=>typeof x!=='string'||!x)||new Set(gallery).size!==gallery.length)throw new Error('商品图片需为不重复的1至9张');
  token(key); const normalized = drafts.normalize(draft), id = 'np_' + hash(openid + ':new:' + key).slice(0, 24);
  const signature = JSON.stringify(gallery.length>1?{draft:normalized,imageIDs:gallery}:{ draft: normalized, imageID:gallery[0]||'' });
  return db.runTransaction(async tx => {
    const ref = tx.collection('products').doc(id), old = await maybeGet(ref);
    if (old) { if (old._createdBy !== openid || old._creationSignature !== signature) throw new Error('保存标识已用于其他商品，请重新提交'); return publicProduct(old); }
    const product = { ...drafts.build(normalized, id, gallery[0]),gallery, _createdBy: openid, _creationSignature: signature };
    await ref.set({ data: product }); return publicProduct(product);
  });
}
async function run({ db, cloud, openid, envId }, event) {
  if (event.action === 'prepareProductFile') {
    const purpose = event.purpose;
    if (!['image', 'import'].includes(purpose) || !['jpg','jpeg','png','gif','webp','xlsx'].includes(event.ext) || purpose === 'import' && event.ext !== 'xlsx' || purpose === 'image' && event.ext === 'xlsx') throw new Error('上传文件类型无效');
    return { cloudPath: filePath(openid, purpose, event.token, event.ext) };
  }
  if (event.action === 'createProduct') {
    drafts.normalize(event.draft);
    const files=event.imageFileIDs===undefined?(event.imageFileID?[event.imageFileID]:[]):event.imageFileIDs;
    if(!Array.isArray(files)||files.length>9||files.some(x=>typeof x!=='string'||!x)||new Set(files).size!==files.length)throw new Error('商品图片无效');
    const photos=[];for(const file of files)photos.push(await image(cloud,file,openid,envId));
    return create(db, event.draft, photos, openid, event.token);
  }
  if (event.action === 'updateProductInfo') {
    if (typeof event.id !== 'string' || !/^[A-Za-z0-9_-]{1,60}$/.test(event.id)) throw new Error('商品编号无效');
    const name = drafts.text(event.name, '商品名称', 120, true), description = drafts.text(event.description, '商品介绍', 1000);
    const ip = drafts.text(event.ip, 'IP名称', 60);
    if (!drafts.TYPES.includes(event.type) || !['明谷','盲盒'].includes(event.group)) throw new Error('商品分类无效');
    const original=await maybeGet(db.collection('products').doc(event.id));if(!original)throw new Error('商品不存在');
    let photos=null;
    const requested=event.imageFileIDs===undefined?(event.imageFileID?[event.imageFileID]:undefined):event.imageFileIDs;
    if(requested!==undefined){
      if(!Array.isArray(requested)||requested.length>9||new Set(requested).size!==requested.length)throw new Error('商品图片无效');
      const existing=new Set([original.image,...(original.gallery||[])]);photos=[];
      for(const file of requested){if(typeof file!=='string'||!file)throw new Error('商品图片无效');photos.push(existing.has(file)?file:await image(cloud,file,openid,envId));}
    }
    return db.runTransaction(async tx => {
      const ref = tx.collection('products').doc(event.id), old = await maybeGet(ref); if (!old) throw new Error('商品不存在');
      const patch = { name, description, ip, group: event.group, type: event.type, updatedAt: Date.now() };
      if (photos) {
        const allowed=new Set([old.image,...(old.gallery||[])]);
        for(const file of photos)if(!allowed.has(file)&&new Set([original.image,...(original.gallery||[])]).has(file))throw new Error('商品图片已由其他管理员修改，请刷新后再保存');
        patch.image=photos[0]||'/assets/placeholder.jpg';patch.gallery=photos;
        if(!photos.length){patch.active=false;patch.needsReview=true;}
      }
      await ref.update({ data: patch }); return publicProduct({ ...old, ...patch, id: event.id });
    });
  }
  const imports = require('./product-import');
  return imports.run({ db, cloud, openid, envId, create, hash, folder, verifyFileID, imageExtension, maybeGet }, event);
}
async function resolveImages(cloud, products) {
  const ids = [...new Set(products.flatMap(p => [p.image, ...(p.gallery || [])]).filter(x => typeof x === 'string' && x.startsWith('cloud://')))];
  if (!ids.length) return products.map(publicProduct);
  const urls = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const response = await cloud.getTempFileURL({ fileList: ids.slice(i, i + 50) });
    for (const file of response.fileList || []) if (file.tempFileURL) urls.set(file.fileID, file.tempFileURL);
  }
  return products.map(p => { const value = publicProduct(p); return { ...value, imageFileID: p.image && p.image.startsWith('cloud://') ? p.image : '',galleryFileIDs:(p.gallery||[]).slice(),
    image: urls.get(p.image) || p.image, gallery: (p.gallery || []).map(x => urls.get(x) || x) }; });
}
module.exports = { ACTIONS, run, create, resolveImages, verifyFileID, filePath, imageExtension, publicProduct };
