function fail(m){throw new Error(m)}
function cents(value){if(typeof value!=='string'||!/^\d{1,6}(\.\d{1,2})?$/.test(value.trim()))fail('价格需为正数，最多两位小数');const [whole,frac='']=value.trim().split('.');const n=Number(whole)*100+Number(frac.padEnd(2,'0'));if(n<=0||n>99999999)fail('价格超出允许范围');return n}
function patchProduct(product,patch){
 if(!product||!Array.isArray(product.skus))fail('商品不存在');
 if(!patch||typeof patch.skuId!=='string'||!Number.isInteger(patch.priceCents)||patch.priceCents<=0||patch.priceCents>99999999||!Number.isInteger(patch.stockDelta)||Math.abs(patch.stockDelta)>10000||typeof patch.active!=='boolean')fail('商品修改参数无效');
 const p=JSON.parse(JSON.stringify(product)),sku=p.skus.find(s=>s.id===patch.skuId);if(!sku)fail('商品款式不存在');
 const stock=sku.stock+patch.stockDelta;if(!Number.isSafeInteger(stock)||stock<0||stock>1000000)fail('库存调整后不能为负数或超过上限');
 sku.stock=stock;sku.price=patch.priceCents;p.active=patch.active;p.updatedAt=Date.now();return p;
}
module.exports={cents,patchProduct};
