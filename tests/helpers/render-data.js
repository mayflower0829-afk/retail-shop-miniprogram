// Emulate the array paths supported by the native setData rendering bridge.
module.exports=function applyDataPatch(data,patch){
 for(const [key,value] of Object.entries(JSON.parse(JSON.stringify(patch)))){
  const parts=key.replace(/\[(\d+)\]/g,'.$1').split('.');let target=data;
  for(let i=0;i<parts.length-1;i++){target[parts[i]]??=/^\d+$/.test(parts[i+1])?[]:{};target=target[parts[i]]}
  target[parts[parts.length-1]]=value;
 }
};
