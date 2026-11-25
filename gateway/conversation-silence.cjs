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

class CustomerSilence {
  constructor() { this.reset(); }
  reset() {
    this.elapsed = 0;
    this.waitingSince = undefined;
    this.recoveryAttempted = false;
    this.continuationAttempted = false;
  }
  speech() { this.reset(); }
  pause(now) {
    if (this.waitingSince === undefined) return;
    this.elapsed += now - this.waitingSince;
    this.waitingSince = undefined;
  }
  tick(now, blocked) {
    if (blocked) {
      this.pause(now);
      return;
    }
    this.waitingSince ??= now;
    const elapsed = this.elapsed + now - this.waitingSince;
    if (elapsed >= 20000) return 'timeout';
    if (elapsed >= 15000 && this.recoveryAttempted && !this.continuationAttempted) {
      this.continuationAttempted = true;
      this.pause(now);
      return 'continue';
    }
    if (elapsed >= 10000 && !this.recoveryAttempted) {
      this.recoveryAttempted = true;
      this.pause(now);
      return 'recover';
    }
  }
}
module.exports = {ConversationSilence, CustomerSilence};
