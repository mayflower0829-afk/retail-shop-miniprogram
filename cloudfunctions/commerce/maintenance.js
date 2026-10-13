const crypto=require('crypto');
const TRIGGER_NAME='commerce-order-expiry';
function validTimer(event,context,env=process.env){
 if(!event||event.Type!=='Timer'||event.TriggerName!==TRIGGER_NAME||context&&context.OPENID)return false;
 const expected=env.ORDER_MAINTENANCE_TOKEN,actual=event.Message;
 if(typeof expected!=='string'||! /^[a-f0-9]{64}$/.test(expected)||typeof actual!=='string')return false;
 const a=Buffer.from(expected),b=Buffer.from(actual);return a.length===b.length&&crypto.timingSafeEqual(a,b);
}
async function expire(db,cancel,sync){
 const started=Date.now(),result={cancelled:0,paid:0,skipped:0,failed:0};
 const {data:orders}=await db.collection('orders').where({status:'pending',expiresAt:db.command.lt(started)}).orderBy('expiresAt','asc').limit(25).get();
 for(const o of orders){
  if(Date.now()-started>18000){result.skipped++;break}
  if(o.lock){
   if(!['pay','close'].includes(o.lock)||!Number.isSafeInteger(o.lockAt)||o.lockAt>started-120000){result.skipped++;continue}
   try{
    const payment=await sync(o.id);if(payment.trade_state==='SUCCESS'){result.paid++;continue}
    if(!['NOTPAY','CLOSED','ORDER_NOT_EXIST','PAYERROR','REVOKED'].includes(payment.trade_state)){result.skipped++;continue}
    const released=await db.runTransaction(async tx=>{const ref=tx.collection('orders').doc(o.id),{data:x}=await ref.get();if(x.status!=='pending'||x.lock!==o.lock||x.lockAt!==o.lockAt||x.expiresAt>=Date.now())return false;await ref.update({data:{lock:'',lockAt:0}});return true});
    if(!released){result.skipped++;continue}
   }catch(e){result.failed++;continue}
  }
  try{const r=await cancel(o);if(r.status==='cancelled')result.cancelled++}
  catch(e){try{const r=await sync(o.id);if(r.trade_state==='SUCCESS')result.paid++;else result.failed++}catch(ignore){result.failed++}}
 }
 return result;
}
module.exports={TRIGGER_NAME,validTimer,expire};
