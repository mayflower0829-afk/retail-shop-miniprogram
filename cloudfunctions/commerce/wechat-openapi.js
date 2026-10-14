const https=require('https'),crypto=require('crypto');
const PATHS=new Set(['/wxa/sec/order/get_order','/wxa/sec/order/upload_shipping_info','/wxa/sec/order/is_trade_managed']);
function post(path,data){
 return new Promise((resolve,reject)=>{const body=JSON.stringify(data),req=https.request({hostname:'api.weixin.qq.com',path,method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body),'User-Agent':'RetailShop/0.1.6'}},res=>{
  const chunks=[];let length=0;res.on('data',chunk=>{length+=chunk.length;if(length>1024*1024)req.destroy(new Error('response too large'));else chunks.push(chunk)});
  res.on('end',()=>{if(res.statusCode<200||res.statusCode>=300)return reject(new Error('微信接口暂时无法连接，请稍后重试'));try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))}catch(_){reject(new Error('微信接口返回异常，请稍后重试'))}});
 });req.on('error',()=>reject(new Error('微信接口连接失败，请稍后重试')));req.setTimeout(7000,()=>req.destroy(new Error('timeout')));req.end(body);});
}
function createTransport({request=post,env=process.env,now=Date.now}={}){
 let cache=null,pending=null;
 function credentials(){const appid=env.WX_APPID,secret=env.WX_APP_SECRET;if(!/^wx[0-9a-f]{16}$/i.test(appid||'')||typeof secret!=='string'||!secret.trim()||secret.length>128)throw new Error('小程序接口密钥尚未配置');return {appid,secret:secret.trim()}}
 async function accessToken(){const c=credentials(),key=crypto.createHash('sha256').update(c.appid+':'+c.secret).digest('hex');if(cache&&cache.key===key&&cache.expiresAt>now())return cache.token;if(pending&&pending.key===key)return pending.promise;
  const promise=(async()=>{const r=await request('/cgi-bin/stable_token',{grant_type:'client_credential',appid:c.appid,secret:c.secret,force_refresh:false});if(r.errcode||typeof r.access_token!=='string'||!r.access_token||!Number.isInteger(r.expires_in)||r.expires_in<=60){const e=new Error('小程序接口凭据获取失败，请核对密钥与接口设置');e.code=r.errcode;throw e}cache={key,token:r.access_token,expiresAt:now()+(r.expires_in-60)*1000};return cache.token})();pending={key,promise};try{return await promise}finally{if(pending&&pending.promise===promise)pending=null}
 }
 async function call(path,data){if(!PATHS.has(path))throw new Error('不支持的微信接口');let token=await accessToken(),r=await request(path+'?access_token='+encodeURIComponent(token),data);
  if([40001,40014,42001].includes(r.errcode)){cache=null;token=await accessToken();r=await request(path+'?access_token='+encodeURIComponent(token),data)}return r;
 }
 return {call};
}
const transport=createTransport();
module.exports={createTransport,call:transport.call};
