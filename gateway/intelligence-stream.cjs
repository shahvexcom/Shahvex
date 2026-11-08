'use strict';
// Incremental bounded JSONL control stream. Raw model strings never reach TTS directly.
class IntelligenceStream {
  constructor(consume,signal){this.consume=consume;this.signal=signal;this.pending='';this.raw='';this.count=0;this.ended=false;}
  push(delta){
    this.signal.throwIfAborted();if(this.ended||typeof delta!=='string'||this.raw.length+delta.length>16000)throw Error('Invalid intelligence stream');
    this.raw+=delta;this.pending+=delta;let at;
    while((at=this.pending.indexOf('\n'))>=0){const line=this.pending.slice(0,at);this.pending=this.pending.slice(at+1);this.line(line);}
    if(this.pending.length>4096)throw Error('Intelligence unit exceeds limit');
  }
  line(line){
    this.signal.throwIfAborted();if(!line.trim())return;if(line.length>4096||++this.count>64)throw Error('Intelligence units exceed limit');
    let unit;try{unit=JSON.parse(line);}catch{throw Error('Malformed intelligence unit');}
    if(!unit||typeof unit!=='object'||Array.isArray(unit))throw Error('Invalid intelligence unit');
    this.consume(unit);
  }
  finish(reply){
    if(!this.raw)this.push(reply);
    if(reply!==this.raw)throw Error('Intelligence final response differs from stream');
    this.line(this.pending);this.pending='';this.ended=true;
    if(!this.count)throw Error('Empty intelligence response');
  }
}
module.exports={IntelligenceStream};
