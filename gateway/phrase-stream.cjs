'use strict';
// Bounded text-only bridge. Never rewrite, truncate or log model wording.
class PhraseStream {
  constructor(signal, onPhrase = () => {}) {
    this.signal=signal;this.onPhrase=onPhrase;this.text='';this.rest='';this.queue=[];this.done=false;this.error=null;this.wake=null;
    this.cancel=()=>this.fail(signal.reason || Error('Cancelled'));
    signal.addEventListener('abort',this.cancel,{once:true});if(signal.aborted)this.cancel();
  }
  emit(raw) {
    const text=raw.trim();if(!text)return;
    if(this.queue.length>=1024)throw Error('Phrase queue exceeds limit');
    this.queue.push(text);this.onPhrase(text);this.wake?.();this.wake=null;
  }
  push(delta) {
    this.signal.throwIfAborted();if(this.error)throw this.error;
    if(this.done || typeof delta!=='string')throw Error('Invalid model delta');
    if(this.text.length+delta.length>16000)throw Error('Model text exceeds limit');
    this.text+=delta;this.rest+=delta;
    while(this.rest.trim()) {
      let cut=0;
      // Require a following separator: a token ending in punctuation may still
      // be a decimal or abbreviation. Keep incomplete words across NDJSON packets.
      const boundaries=/[.!?,;:]["')\]]*(?=\s)/g;let match;
      while((match=boundaries.exec(this.rest))) {
        const end=match.index+match[0].length,prefix=this.rest.slice(0,end);
        const sentence=/[.!?]/.test(match[0][0]);
        if(sentence && /(?:\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc)|\b[A-Z]|(?:\b[A-Za-z]\.)+[A-Za-z])\.$/i.test(prefix.trim()))continue;
        if(prefix.trim().length>=(sentence?24:40) && end<=300){cut=end;break;}
      }
      // Long unpunctuated output must still fit the installed native API. Wait
      // for a word boundary; never send part of an unfinished word.
      if(!cut && this.rest.length>300){cut=this.rest.slice(0,301).lastIndexOf(' ');if(cut<24)throw Error('No safe synthesis boundary within limit');}
      if(!cut)break;
      this.emit(this.rest.slice(0,cut));this.rest=this.rest.slice(cut);
    }
  }
  finish(reply) {
    if(!this.text)this.push(reply); // Existing non-streaming/mock adapters remain supported.
    if(reply!==this.text)throw Error('Streamed text differs from final response');
    this.emit(this.rest);this.rest='';this.done=true;this.wake?.();this.wake=null;
  }
  fail(error){if(this.error)return;this.error=error;this.queue=[];this.wake?.();this.wake=null;}
  async *[Symbol.asyncIterator](){
    while(true){if(this.error)throw this.error;if(this.queue.length){yield this.queue.shift();continue;}if(this.done)return;await new Promise(resolve=>{this.wake=resolve;});}
  }
  dispose(){this.signal.removeEventListener('abort',this.cancel);this.queue=[];}
}
module.exports={PhraseStream};
