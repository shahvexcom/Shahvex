'use strict';
// Require following whitespace: punctuation at the end of a token can still be
// the start of a decimal, currency amount, time or abbreviation in the next delta.
function speechBoundary(text, phrases=false, final=false){
  const pattern = phrases
    ? /[.!?,;:](?:["')\]]*)(?=\s)/g
    : /[.!?](?:["')\]]*)(?=\s|$)/g;
  for(const match of text.matchAll(pattern)){
    const at=match.index+match[0].length,prefix=text.slice(0,at).trim();
    if(/[.!?]/.test(match[0][0])){
      if (!final && at === text.length && match[0][0] === '.') continue;
      if(/(?:\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|e\.g|i\.e)|(?:\b[A-Za-z]\.)+[A-Za-z])\.$/i.test(prefix) || /\b[A-Z]\.$/.test(prefix))continue;
      return at;
    }
    // Skip tiny fragments and numeric punctuation, e.g. "2, 000 PKR".
    if(prefix.length<40 || prefix.split(/\s+/).length<6 || /\d[,;:]$/.test(prefix))continue;
    // Keep incomplete prices together across a punctuation boundary.
    if(/\b(?:PKR|USD|GBP|EUR|Rs\.?)\s*[,;:]$/i.test(prefix) && !/\d[\d,.]*\s+(?:PKR|USD|GBP|EUR)[,;:]$/i.test(prefix))continue;
    return at;
  }
  return 0;
}
module.exports={speechBoundary};
