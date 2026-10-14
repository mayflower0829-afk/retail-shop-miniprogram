const test=require('node:test'),assert=require('node:assert/strict'),{createTransport}=require('../cloudfunctions/commerce/wechat-openapi');
const env={WX_APPID:'wx'+'0123456789abcdef',WX_APP_SECRET:'mock-secret-not-a-real-key'};
test('official token requests keep credentials server side, cache concurrent calls and never force invalidation',async()=>{
 let tokens=0,requests=[];const api=createTransport({env,request:async(path,data)=>{requests.push({path,data});if(path==='/cgi-bin/stable_token'){tokens++;assert.equal(data.force_refresh,false);assert.equal(data.secret,env.WX_APP_SECRET);return {access_token:'mock-token',expires_in:7200}}return {errcode:0,is_trade_managed:true}}});
 const r=await Promise.all([api.call('/wxa/sec/order/is_trade_managed',{appid:env.WX_APPID}),api.call('/wxa/sec/order/get_order',{transaction_id:'mock-order'})]);assert.equal(tokens,1);assert.equal(r[0].is_trade_managed,true);assert.ok(requests.filter(x=>x.path.includes('access_token')).every(x=>!Object.hasOwn(x.data,'secret')));await assert.rejects(()=>api.call('/evil/endpoint',{}));
});
test('an expired token retries once; invalid merchant or token responses never become success',async()=>{
 let tokens=0,calls=0;const api=createTransport({env,request:async path=>path==='/cgi-bin/stable_token'?{access_token:'token-'+(++tokens),expires_in:7200}:++calls===1?{errcode:42001}:{errcode:0}});assert.equal((await api.call('/wxa/sec/order/get_order',{})).errcode,0);assert.equal(tokens,2);assert.equal(calls,2);
 const failure=createTransport({env,request:async()=>({errcode:40125,errmsg:'secret response must not escape'})});await assert.rejects(()=>failure.call('/wxa/sec/order/get_order',{}),e=>e.code===40125&&!e.message.includes('secret response'));
 await assert.rejects(()=>createTransport({env:{}}).call('/wxa/sec/order/get_order',{}));
});
