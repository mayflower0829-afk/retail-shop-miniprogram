const test=require('node:test'),assert=require('node:assert/strict');
const m=require('../cloudfunctions/commerce/maintenance');
const env={ORDER_MAINTENANCE_TOKEN:'a'.repeat(64)};
const event={Type:'Timer',TriggerName:m.TRIGGER_NAME,Message:env.ORDER_MAINTENANCE_TOKEN};
test('only the private timer message runs global expiration',()=>{assert.equal(m.validTimer(event,{},env),true);for(const e of [{...event,Type:'other'},{...event,TriggerName:'fake'},{...event,Message:'b'.repeat(64)},{...event,Message:null}])assert.equal(m.validTimer(e,{},env),false);assert.equal(m.validTimer(event,{OPENID:'visitor'},env),false);assert.equal(m.validTimer(event,{},{}),false)});
function db(rows){
 const values=new Map(rows.map(o=>[o.id,{...o}]));
 return {
  values,command:{lt:x=>({$lt:x})},
  collection(){return {
   where(){return {orderBy(){return this},limit(){return this},async get(){return {data:[...values.values()]}}}},
   doc(id){return {async get(){return {data:values.get(id)}},async update({data}){values.set(id,{...values.get(id),...data})}}}
  }},
  async runTransaction(fn){return fn(this)}
 }
}
test('one failed query does not block later expired orders and never releases their inventory',async()=>{const d=db([{id:'unavailable'},{id:'ok'},{id:'locked',lock:'pay',lockAt:Date.now()}]),closed=[];const r=await m.expire(d,async o=>{if(o.id==='unavailable')throw new Error('network');closed.push(o.id);return {status:'cancelled'}},async()=>{throw new Error('network')});assert.deepEqual(closed,['ok']);assert.equal(r.cancelled,1);assert.equal(r.failed,1);assert.equal(r.skipped,1)});
test('paid orders are preserved when cancellation loses a payment race',async()=>{const d=db([{id:'paid'}]);const r=await m.expire(d,async()=>{throw new Error('paid')},async()=>({trade_state:'SUCCESS'}));assert.equal(r.paid,1);assert.equal(r.cancelled,0)});
test('stale payment locks are cleared only after authoritative NOTPAY query',async()=>{const o={id:'stale',status:'pending',lock:'pay',lockAt:Date.now()-180000,expiresAt:Date.now()-300000};const d=db([o]);const r=await m.expire(d,async()=>({status:'cancelled'}),async()=>({trade_state:'NOTPAY'}));assert.equal(r.cancelled,1);assert.equal(d.values.get(o.id).lock,'');const unknown=db([o]);const u=await m.expire(unknown,async()=>{throw new Error('must not cancel')},async()=>({trade_state:'UNKNOWN'}));assert.equal(u.cancelled,0);assert.equal(unknown.values.get(o.id).lock,'pay')});
