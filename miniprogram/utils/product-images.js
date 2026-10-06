const assets = require('../data/image-assets');
function assetFor(id) { return Object.prototype.hasOwnProperty.call(assets, id) ? assets[id] : null; }
function detailUrl(id, preview = false) {
  const asset = assetFor(id);
  return (asset ? `/${asset.root}/detail/index` : '/pages/detail/index') + '?id=' + encodeURIComponent(id) + (preview ? '&preview=1' : '');
}
function hasImage(p) { return !!p.image && !p.image.endsWith('placeholder.jpg'); }
function galleryFor(p, packageRoot) {
  const gallery = p.gallery && p.gallery.length ? p.gallery : [p.image];
  const asset = assetFor(p.id);
  // Native pages may use their own image package or public remote product photos.
  if (asset && asset.root === packageRoot && gallery.every(url => url.startsWith('/assets/'))) return asset.gallery.slice();
  return gallery.filter(Boolean);
}
function openPreview(id) { wx.navigateTo({ url: detailUrl(id, true) }); }
const previewFiles = new Map();
function previewPath(url) {
  if (!url.startsWith('/') || url.startsWith('//')) return Promise.resolve(url);
  if (previewFiles.has(url)) return previewFiles.get(url);
  // The native full-screen viewer needs a readable local file, rather than a package URL.
  const filePath = wx.env.USER_DATA_PATH + '/product-preview-v1-' + url.replace(/[^a-zA-Z0-9._-]/g, '_');
  const file = new Promise((resolve, reject) => wx.getFileSystemManager().copyFile({
    srcPath: url.slice(1), destPath: filePath, success: () => resolve(filePath), fail: reject
  }));
  previewFiles.set(url, file);
  file.catch(() => previewFiles.delete(url));
  return file;
}
async function previewGallery(urls, index) {
  const files = await Promise.all(urls.map(previewPath));
  return new Promise((resolve, reject) => wx.previewImage({ current: files[index], urls: files, success: resolve, fail: reject }));
}
module.exports = { assetFor, detailUrl, hasImage, galleryFor, openPreview, previewGallery };
