'use strict';
// Chatterbox's installed HTTP wrapper accepts at most 350 characters.
// Preserve wording/order; never silently truncate mandatory disclosures.
function textChunks(text, limit = 300) {
  if (typeof text !== 'string' || !text.trim()) throw Error('Empty synthesis text');
  const chunks = []; let rest = text.trim();
  // First complete sentence can be played while later sentences synthesize.
  // Never manufacture filler or truncate/rewrite required wording.
  const first = /[.!?](?:["')\]]*)(?=\s|$)/.exec(rest);
  if (first && first.index + first[0].length <= 120 && first.index >= 20) {
    const cut = first.index + first[0].length;
    chunks.push(rest.slice(0, cut)); rest = rest.slice(cut).trimStart();
  } else if (rest.length > 120) {
    const prefix=rest.slice(0,121);
    const clause=Math.max(prefix.lastIndexOf(', '),prefix.lastIndexOf('; '),prefix.lastIndexOf(': '));
    const cut=clause>=40 ? clause+1 : prefix.lastIndexOf(' ');
    if(cut>=40){chunks.push(rest.slice(0,cut));rest=rest.slice(cut).trimStart();}
  }
  while (rest.length > limit) {
    const prefix = rest.slice(0, limit + 1);
    let cut = Math.max(prefix.lastIndexOf('. '), prefix.lastIndexOf('? '), prefix.lastIndexOf('! '));
    cut = cut >= 20 ? cut + 1 : prefix.lastIndexOf(' ');
    if (cut < 1) cut = limit;
    chunks.push(rest.slice(0, cut)); rest = rest.slice(cut).trimStart();
  }
  if (rest) chunks.push(rest); return chunks;
}
module.exports = { textChunks };
