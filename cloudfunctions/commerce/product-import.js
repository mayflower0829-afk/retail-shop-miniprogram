const drafts = require('./product-draft');
const MAX_FILE = 10 * 1024 * 1024, MAX_ROWS = 1000;
const HEADERS = { name:['商品名称','名称','品名'], price:['零售价','单价','零售单价','价格'], stock:['数量','库存','库存数量'], group:['商品分组','分组'], type:['商品类型','类型','分类'], ip:['IP','IP名称','作品'], description:['商品介绍','介绍','备注'], skuName:['款式','款式名称'] };
function cellValue(cell) {
  const v = cell.value;
  if (v && typeof v === 'object') {
    if (v.formula || v.sharedFormula) { if (v.result === undefined || v.result && typeof v.result === 'object') throw new Error('公式没有有效结果，请改为数值'); return v.result; }
    if (v.richText) return v.richText.map(x=>x.text).join('');
    if (v.hyperlink || v.error) throw new Error('请使用普通文本或数值');
  }
  return v === null || v === undefined ? '' : v;
}
function label(cell) { try { return String(cellValue(cell)).trim().replace(/[\s（(].*$/, ''); } catch (_) { return ''; } }
async function parse(buffer, fallbackGroup='明谷') {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_FILE) throw new Error('Excel文件需小于10MB');
  if (!['明谷','盲盒'].includes(fallbackGroup)) throw new Error('商品分组无效');
  const JSZip = require('jszip'), ExcelJS = require('exceljs');
  let zip; try { zip = await JSZip.loadAsync(buffer); } catch (_) { throw new Error('无法读取文件，请选择有效的.xlsx表格'); }
  const files = Object.values(zip.files); let expanded=0, cells=0, rowCount=0;
  if (files.length>2500 || !zip.file('xl/workbook.xml')) throw new Error('表格格式或大小不受支持');
  for (const file of files) {
    if (file.dir) continue;
    expanded += file._data && file._data.uncompressedSize || 0;
    if (expanded > 20*1024*1024 || /vbaProject|externalLinks/i.test(file.name)) throw new Error('请使用不含宏或外部链接的简洁商品表格');
    if (/\.xml$/i.test(file.name)) {
      const xml = await file.async('string');
      if (xml.length>8*1024*1024 || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('表格内容过大或格式不受支持');
      if (/^xl\/worksheets\//.test(file.name)) { cells+=(xml.match(/<c[\s>]/g)||[]).length; rowCount+=(xml.match(/<row[\s>]/g)||[]).length; }
      if (cells>50000 || rowCount>5000) throw new Error('表格过大，请分成较小文件导入');
    }
  }
  const book = new ExcelJS.Workbook(); try { await book.xlsx.load(buffer); } catch (_) { throw new Error('无法读取Excel内容，请重新保存为.xlsx'); }
  const rows=[], errors=[], photos=new Map(); let matched=0;
  for (const sheet of book.worksheets) {
    let headerRow=0, columns={};
    for(let n=1;n<=Math.min(10,sheet.rowCount);n++) {
      const found={}; sheet.getRow(n).eachCell((cell,col)=> { if(col>40)return; const h=label(cell); for(const [key,names] of Object.entries(HEADERS)) if(names.includes(h))found[key]=col; });
      if (found.name && found.price && found.stock) { headerRow=n;columns=found;break; }
    }
    if(!headerRow)continue;matched++;
    const images=new Map();
    for(const item of sheet.getImages()) { const range=item.range, tl=range && range.tl; if(!tl)continue; const n=(tl.nativeRow === undefined ? Math.floor(tl.row) : tl.nativeRow)+1; if(!images.has(n))images.set(n,book.getImage(item.imageId)); }
    for(let n=headerRow+1;n<=sheet.rowCount;n++) {
      const row=sheet.getRow(n), key=sheet.id+':'+n, source=sheet.name+' 第'+n+'行';
      const raw={};let any=false, error='';
      try { for(const [field,col] of Object.entries(columns)) { raw[field]=cellValue(row.getCell(col)); if(raw[field] !== '')any=true; } } catch(e) { error=e.message; any=true; }
      if(!any)continue;
      if(rows.length+errors.length>=MAX_ROWS)throw new Error('每次最多导入1000行，请拆分文件');
      try {
        if(error)throw new Error(error);
        const stockText=String(raw.stock).trim(); if(!/^\d{1,7}$/.test(stockText))throw new Error('数量需为非负整数');
        let group=String(raw.group||fallbackGroup).trim(), type=String(raw.type||'').trim();
        if(type==='明谷'||type==='盲盒'){group=type;type='';}
        const draft=drafts.normalize({name:String(raw.name||''),price:String(raw.price),stock:Number(stockText),group,type:type||undefined,ip:String(raw.ip||''),description:String(raw.description||''),skuName:String(raw.skuName||'默认款')});
        const photo=images.get(n); let photoBuffer=photo && photo.buffer;
        if(photo && !photoBuffer && photo.base64)photoBuffer=Buffer.from(photo.base64.replace(/^data:[^,]+,/,''),'base64');
        if(photoBuffer){require('./product-management').imageExtension(photoBuffer);photos.set(key,photoBuffer);}
        rows.push({key,source,...draft,hasImage:!!photoBuffer});
      }catch(e){errors.push({source,message:e.message});}
    }
  }
  if(!matched)throw new Error('未找到“商品名称、零售价、数量”表头；请使用模板或原有商品表');
  if(!rows.length && !errors.length)throw new Error('表格没有商品数据');
  if(Buffer.byteLength(JSON.stringify({rows,errors}))>650000)throw new Error('商品介绍较多，请拆分文件导入');
  return {rows,errors,photos};
}
function view(job) { return {jobId:job.id,rows:job.rows,errors:job.errors,count:job.rows.length,drafts:job.rows.filter(r=>!r.hasImage).length}; }
async function run(ctx,event) {
  const {db,cloud,openid,envId,hash,verifyFileID,maybeGet,create,imageExtension}=ctx;
  if(event.action==='getProductImportTemplate') {
    const ExcelJS=require('exceljs'), book=new ExcelJS.Workbook(), sheet=book.addWorksheet('商品');
    sheet.addRow(['商品名称','零售价','数量','商品分组','商品类型','IP','款式','商品介绍']);
    sheet.getRow(1).font={bold:true};sheet.columns.forEach((c,i)=>c.width=i===0?30:18);
    const r=await cloud.uploadFile({cloudPath:ctx.folder(openid,'import')+hash(openid+':template-v1')+'.xlsx',fileContent:Buffer.from(await book.xlsx.writeBuffer())});
    const urls=await cloud.getTempFileURL({fileList:[r.fileID]}); const file=urls.fileList && urls.fileList[0];
    if(!file || !file.tempFileURL)throw new Error('模板生成失败，请重试');return {fileID:r.fileID,url:file.tempFileURL};
  }
  if(event.action==='previewProductImport') {
    verifyFileID(event.fileID,openid,'import',envId);
    const {fileContent}=await cloud.downloadFile({fileID:event.fileID}), digest=hash(fileContent);
    const group=event.group||'明谷';const id='import_'+hash(openid+':'+digest+':'+group).slice(0,40), ref=db.collection('inventory_changes').doc(id);
    const old=await maybeGet(ref);if(old){if(old.owner!==openid)throw new Error('无权读取此导入记录');return view(old);}
    const parsed=await parse(fileContent,group), job={id,owner:openid,fileID:event.fileID,digest,group,rows:parsed.rows,errors:parsed.errors,createdAt:Date.now(),kind:'product_import'};
    await ref.set({data:job});return view(job);
  }
  if(event.action==='commitProductImport') {
    if(typeof event.jobId!=='string'||!/^import_[a-f0-9]{40}$/.test(event.jobId)||!Number.isInteger(event.offset)||event.offset<0)throw new Error('导入批次无效');
    const job=await maybeGet(db.collection('inventory_changes').doc(event.jobId)); if(!job||job.owner!==openid||job.kind!=='product_import')throw new Error('无权操作此导入记录');
    if(event.offset>job.rows.length)throw new Error('导入位置无效');
    const downloaded=await cloud.downloadFile({fileID:verifyFileID(job.fileID,openid,'import',envId)});
    if(hash(downloaded.fileContent)!==job.digest)throw new Error('表格已更改，请重新预览');
    const parsed=await parse(downloaded.fileContent,job.group), batch=job.rows.slice(event.offset,event.offset+8), ids=[];
    for(const row of batch) {
      const bytes=parsed.photos.get(row.key);let photo='';
      if(row.hasImage && !bytes)throw new Error('商品图片发生变化，请重新预览');
      if(bytes){ const ext=imageExtension(bytes);const r=await cloud.uploadFile({cloudPath:ctx.folder(openid,'image')+hash(openid+':'+job.id+':'+row.key)+'.'+ext,fileContent:bytes});photo=r.fileID; }
      const product=await create(db,row,photo,openid,hash(job.id+':'+row.key));ids.push(product.id);
    }
    const nextOffset=event.offset+batch.length;return {ids,nextOffset,done:nextOffset>=job.rows.length,total:job.rows.length};
  }
  throw new Error('不支持的商品导入操作');
}
module.exports={parse,run,MAX_FILE,HEADERS};
