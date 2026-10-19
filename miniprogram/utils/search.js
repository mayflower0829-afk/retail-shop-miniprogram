// Search is local and transient; no search history is stored.
function normalize(value){return String(value||'').replace(/[！-～]/g,c=>String.fromCharCode(c.charCodeAt(0)-65248)).replace(/　/g,' ').toLowerCase()}
function matcher(query){
 const words=normalize(query).trim().split(/\s+/).filter(Boolean);
 return p=>{if(!words.length)return true;const text=[p.name,p.displayName,p.ip,p.type,p.group,...(p.skus||[]).map(k=>k.name)].map(normalize).join(' ');return words.every(word=>text.includes(word))};
}
module.exports={matcher};
