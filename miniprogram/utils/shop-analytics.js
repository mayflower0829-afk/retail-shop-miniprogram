const DAY=86400000,OFFSET=8*3600000;
function localDay(now=Date.now()){const start=Math.floor((now+OFFSET)/DAY)*DAY-OFFSET;return {start,end:start+DAY,date:new Date(start+OFFSET).toISOString().slice(0,10)}}
function paidSummary(rows,now=Date.now(),allowDemo=false) {
 const {start,end,date}=localDay(now);let paidCount=0,paidCents=0,refundedCents=0,unknownRefunds=0;
 for(const o of rows){if(o.kind==='payment_test'||o.demo===true&&!allowDemo||(!o.transactionId&&!(allowDemo&&o.demo===true))||!Number.isSafeInteger(o.total)||o.total<0)continue;
  if(o.paidAt>=start&&o.paidAt<end&&['paid','shipped','ready_pickup','completed','refund_requested','refunded'].includes(o.status)){paidCount++;paidCents+=o.total;}
  if(o.status==='refunded'&&o.refundedAt>=start&&o.refundedAt<end){if(Number.isSafeInteger(o.refundAmountCents)&&o.refundAmountCents>=0&&o.refundAmountCents<=o.total)refundedCents+=o.refundAmountCents;else unknownRefunds++;}
 }
 return {date,paidCount,paidCents,refundedCents,unknownRefunds};
}
module.exports={DAY,OFFSET,localDay,paidSummary};
