const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),cp=require('child_process');
const root=path.resolve(__dirname,'..'),mp=path.join(root,'miniprogram');
const app=JSON.parse(fs.readFileSync(path.join(mp,'app.json'))),packages=app.subPackages||[];
function size(dir){return fs.readdirSync(dir,{withFileTypes:true}).reduce((n,e)=>n+(e.isDirectory()?size(path.join(dir,e.name)):fs.statSync(path.join(dir,e.name)).size),0)}
function checkFiles(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())checkFiles(p);else{if(p.endsWith('.json'))JSON.parse(fs.readFileSync(p));if(p.endsWith('.js')){if(p.startsWith(mp))assert.ok(!/require\([^)]*\.json['"]/.test(fs.readFileSync(p,'utf8')),'原生小程序不能require JSON');cp.execFileSync(process.execPath,['--check',p])}}}}
checkFiles(mp);checkFiles(path.join(root,'cloudfunctions'));
const packageSizes=packages.map(p=>({root:p.root,bytes:size(path.join(mp,p.root))}));
const total=size(mp),main=total-packageSizes.reduce((n,p)=>n+p.bytes,0);
assert.ok(main<2*1024*1024,'主包超过2MB');for(const p of packageSizes)assert.ok(p.bytes<2*1024*1024,p.root+'超过2MB');
assert.ok(total<20*1024*1024,'工程内部预算：总包控制在20MB以内');
const pages=[...app.pages,...packages.flatMap(s=>s.pages.map(p=>s.root+'/'+p))];
for(const p of pages){for(const ext of ['js','json','wxss','wxml'])assert.ok(fs.existsSync(path.join(mp,p+'.'+ext)),p+'.'+ext);const wxml=fs.readFileSync(path.join(mp,p+'.wxml'),'utf8');let spec;global.Page=p=>spec=p;require(path.join(mp,p+'.js'));for(const binding of wxml.matchAll(/(?:bind|catch)(?:tap|input|change|confirm|error)="([\w]+)"/g))assert.equal(typeof spec[binding[1]],'function',p+' has missing handler '+binding[1])}
const products=require(path.join(mp,'data/products.js')),images=require(path.join(mp,'data/image-assets.js')),ids=new Set();
for(const p of products){assert.ok(!ids.has(p.id));ids.add(p.id);for(const i of [p.image,...p.gallery])assert.ok(fs.existsSync(path.join(mp,i)),i);for(const s of p.skus){assert.ok(Number.isInteger(s.stock)&&s.stock>=0);assert.ok(Number.isInteger(s.price)&&s.price>0)}const image=images[p.id];if(image){assert.ok(pages.includes(image.root+'/detail/index'));for(const url of image.gallery){assert.ok(url.startsWith('/'+image.root+'/'));assert.ok(fs.existsSync(path.join(mp,url)),url)}}}
for(const tab of app.tabBar.list){assert.ok(app.pages.includes(tab.pagePath));assert.ok(fs.existsSync(path.join(mp,tab.iconPath)));assert.ok(fs.existsSync(path.join(mp,tab.selectedIconPath)))}
for(const file of ['domain.js','business.js','inventory.js','consent-version.js'])assert.equal(fs.readFileSync(path.join(mp,'utils',file),'utf8'),fs.readFileSync(path.join(root,'cloudfunctions/commerce',file),'utf8'),'前后端规则必须一致: '+file);
console.log(JSON.stringify({pages:pages.length,products:products.length,mainPackageBytes:main,totalPackageBytes:total,imagePackages:packageSizes},null,2));
