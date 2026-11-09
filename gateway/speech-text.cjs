'use strict';
// Normalize explicit English currency amounts only; leave IDs/phones untouched.
const small=['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen'];
const tens=['','','twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety'];
function words(n){
  if(n<20)return small[n];
  if(n<100)return tens[Math.floor(n/10)]+(n%10?' '+small[n%10]:'');
  if(n<1000)return small[Math.floor(n/100)]+' hundred'+(n%100?' '+words(n%100):'');
  for(const [scale,label] of [[1e9,'billion'],[1e6,'million'],[1000,'thousand']])if(n>=scale)return words(Math.floor(n/scale))+' '+label+(n%scale?' '+words(n%scale):'');
}
function amount(raw,currency){
  if(!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(raw))return null;
  const [whole,fraction]=raw.replaceAll(',','').split('.');const n=Number(whole);
  if(!Number.isSafeInteger(n)||n>999999999999)return null;
  const c=currency.toLowerCase().replace('.','');
  const unit=/^(pkr|rs|rupees?)$/.test(c)?'Pakistani rupee':c==='usd'?'US dollar':c==='gbp'?'British pound':'euro';
  const sub=/^(pkr|rs|rupees?)$/.test(c)?'paisa':c==='gbp'?'penny':'cent';
  const cents=Number((fraction||'').padEnd(2,'0'));
  return words(n)+' '+unit+(n===1?'':'s')+(cents?' and '+words(cents)+' '+(cents===1?sub:sub==='paisa'?'paisa':sub==='penny'?'pence':sub+'s'):'');
}
function speechText(text){
  return text.replace(/\b(PKR|USD|GBP|EUR|Rs\.?)\s*(\d[\d,]*(?:\.\d{1,2})?)\b|\b(\d[\d,]*(?:\.\d{1,2})?)\s*(PKR|USD|GBP|EUR|rupees?)\b/gi,(original,prefix,first,second,suffix)=>amount(first||second,prefix||suffix)||original);
}
module.exports={speechText};
