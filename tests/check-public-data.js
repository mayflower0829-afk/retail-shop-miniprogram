const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const forbidden=[/-----BEGIN(?: RSA| EC| OPENSSH| ENCRYPTED)? PRIVATE KEY-----/,/\bgh[pousr]_[a-zA-Z0-9]{20,}\b/,/\bgithub_pat_[a-zA-Z0-9_]{20,}\b/,/\bAKIA[0-9A-Z]{16}\b/,/\bwx[0-9a-f]{16}\b/,/\/U[s]ers\//,/\/var\/f[o]lders\//,/xwechat[_]files/,/万事[屋物]/,/凤台[县]/,/\b(?:mg|bh)\d{3}(?:-default)?\b/,/\bcloud\d-[a-z0-9]{12,}\b/];
let files=0;
function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(['.git','node_modules','coverage'].includes(e.name))continue;const f=path.join(dir,e.name),rel=path.relative(root,f);if(e.isDirectory()){assert.ok(e.name!=='private-data'&&e.name!=='product-images','Operational folder: '+rel);walk(f);continue}files++;assert.ok(!/\.(xlsx?|csv|pem|key|p12|pfx|zip|log)$/i.test(e.name),'Private file type: '+rel);assert.notEqual(e.name,'project.private.config.json');assert.ok(!e.name.startsWith('.env')||e.name==='.env.example','Credentials file: '+rel);if(/\.(js|json|wxml|wxss|md|yml|txt)$/.test(e.name)){const text=fs.readFileSync(f,'utf8');for(const rule of forbidden)assert.ok(!rule.test(text),'Sensitive content pattern: '+rel);for(const number of text.match(/\b1\d{10}\b/g)||[])assert.equal(number,'13900000000','Unexpected phone fixture: '+rel)}}}
walk(root);
const config=require('../miniprogram/config'),project=require('../project.config.json'),products=require('../miniprogram/data/products');
assert.equal(project.appid,'touristappid');assert.equal(config.mode,'demo');assert.equal(config.demoAdminEnabled,false);assert.equal(config.cloudEnv,'');assert.equal(config.supportWeChat,'');
assert.equal(products.length,8);
for(const p of products){assert.match(p.id,/^demo-\d{3}$/);assert.ok(p.name.startsWith('示例'));assert.equal(p.source,undefined);assert.equal(p.needsReview,true)}
assert.deepEqual(products,JSON.parse(fs.readFileSync(path.join(root,'cloudfunctions/commerce/seed-products.json'))));
console.log(JSON.stringify({files,syntheticProducts:products.length,privateDataFindings:0}));
