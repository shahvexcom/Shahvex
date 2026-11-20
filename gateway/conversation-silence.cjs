'use strict';
/** Each three-second window starts after playback and restarts on customer speech. */
class ConversationSilence {
 constructor(){this.reset();}
 reset(){this.quietSince=undefined;this.checks=0;}
 speech(){this.reset();}
 finish(){this.checks=4;this.quietSince=undefined;}
 tick(now,blocked){
  if(blocked){this.quietSince=undefined;return;}
  if(this.checks>=5)return;
  if(this.quietSince===undefined){this.quietSince=now;return;}
  if(now-this.quietSince<[3000,3000,3000,3000,500][this.checks])return;
  this.quietSince=undefined;return ++this.checks;
 }
}
module.exports={ConversationSilence};
