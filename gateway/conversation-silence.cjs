'use strict';
/** Listening windows restart after playback; caller speech restarts the sequence. */
class ConversationSilence{
 constructor(){this.reset();}
 reset(){this.quietSince=undefined;this.checks=0;}
 speech(){this.reset();}
 tick(now,blocked){
  if(blocked){this.quietSince=undefined;return;}
  if(this.checks>=4)return;
  if(this.quietSince===undefined){this.quietSince=now;return;}
  if(now-this.quietSince<[5000,4000,3000,5000][this.checks])return;
  this.quietSince=undefined;return ++this.checks;
 }
}
module.exports={ConversationSilence};
