// Small UI work stays off the animation frame; page changes keep native routing.
function cancelSearch(page){if(page._searchTimer){clearTimeout(page._searchTimer);page._searchTimer=null}}
function unlock(page){if(page._navigationTimer)clearTimeout(page._navigationTimer);page._navigationTimer=null;page._navigating=false}
function resume(page){page._viewHidden=false;unlock(page)}
function suspend(page){page._viewHidden=true;page._viewRequest=(page._viewRequest||0)+1;cancelSearch(page);unlock(page)}
function request(page){cancelSearch(page);return page._viewRequest=(page._viewRequest||0)+1}
function current(page,id){return !page._viewHidden&&page._viewRequest===id}
function defer(page,callback){cancelSearch(page);page._searchTimer=setTimeout(()=>{page._searchTimer=null;if(!page._viewHidden)callback()},120)}
function catalogCards(list){return list.map(({id,image,displayName,ip,type,stock,priceText,originalPriceText,hasDiscount,skus})=>({id,image,displayName,ip,type,stock,priceText,originalPriceText,hasDiscount,skuCount:skus.length}))}
function catalogPatch(list,previous=[]){
 const cards=catalogCards(list);
 if(previous.length&&cards.length>previous.length&&previous.every((p,i)=>Object.keys(cards[i]).every(k=>p[k]===cards[i][k]))){const patch={};for(let i=previous.length;i<cards.length;i++)patch['visible['+i+']']=cards[i];return patch}
 return {visible:cards};
}
const fallback={};
function navigate(page,url,method='navigateTo'){
 page=page||fallback;if(page._navigating||page._viewHidden)return false;
 page._navigating=true;page._navigationTimer=setTimeout(()=>unlock(page),500);
 const fail=()=>{unlock(page);if(typeof wx.showToast==='function')wx.showToast({title:'页面暂时无法打开，请重试',icon:'none'})};
 try{wx[method]({url,fail})}catch(_){fail();return false}return true;
}
module.exports={resume,suspend,request,current,defer,cancelSearch,navigate,catalogCards,catalogPatch};
