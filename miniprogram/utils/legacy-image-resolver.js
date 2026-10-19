const manifest = require('../data/image-cloud');
const paths = new Set(manifest.paths || []), cache = new Map(), pending = new Map();
let queued = false;
function fileID(src) { return manifest.filePrefix && paths.has(src) ? manifest.filePrefix + src.slice(1) : ''; }
function migrated(src) { return !!fileID(src); }
function resolve(src, options = {}) {
 const id = fileID(src); if (!id) return Promise.resolve(src);
 if (options.force) cache.delete(id);
 const old = cache.get(id); if (old && old.expires > Date.now()) return Promise.resolve(old.url);
 if (pending.has(id)) return pending.get(id).promise;
 let yes, no; const promise = new Promise((a,b) => { yes=a; no=b; });
 pending.set(id, {promise, yes, no});
 if (!queued) { queued=true; Promise.resolve().then(flush); }
 return promise;
}
async function batch(entries) {
 try {
  const result = await wx.cloud.getTempFileURL({fileList:entries.map(([id])=>id)});
  const files = new Map((result.fileList || []).map(f=>[f.fileID,f]));
  for (const [id,item] of entries) {
   const f=files.get(id), url=f && f.tempFileURL;
   if (typeof url==='string' && /^https:\/\//.test(url) && (!f.status || f.status===0)) {
    cache.set(id,{url,expires:Date.now()+5*60*1000}); item.yes(url);
   } else item.no(new Error('图片暂时无法加载，请重试'));
  }
 } catch (_) { for (const [,item] of entries) item.no(new Error('图片暂时无法加载，请重试')); }
 finally { for (const [id,item] of entries) if (pending.get(id)===item) pending.delete(id); }
}
function flush() {
 queued=false; const entries=[...pending].filter(([,item])=>!item.started);
 for (const [,item] of entries) item.started=true;
 for (let i=0;i<entries.length;i+=50) batch(entries.slice(i,i+50));
}
function resolveMany(urls, options) { return Promise.all(urls.map(src=>resolve(src,options))); }
module.exports = {resolve,resolveMany,migrated};
