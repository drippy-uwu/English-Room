import { BATTLE, TERMINAL, applyArenaAction, busyFight, nextScore, sweepArena } from './battle-state.js';
import { withTimeout } from './firebase.js';
import { createId } from './multiplayer.js';

export async function transactArena(room,action) {
  const ref = room.reference('arena');
  // Keep a listener while transacting: an unobserved location may start with a null cache.
  let unsubscribe;
  await withTimeout(new Promise((resolve,reject) => { unsubscribe = room.sdk.onValue(ref,() => resolve(),reject); })).catch(error => { unsubscribe?.(); throw error; });
  let rejection;
  try {
  const result = await room.sdk.runTransaction(ref,value => {
    // RTDB may retry asynchronously. Never throw from its update callback.
    try { rejection = null; return applyArenaAction(value,action,room.now(),room.players); }
    catch (error) { rejection = error; return undefined; }
  },{applyLocally:false});
  if (!result.committed) throw rejection || new Error('The challenge changed. Please try again.');
  return result.snapshot.val() || {};
  } finally { unsubscribe?.(); }
}

// No writes on taps. Only two score records are updated, at most four times/second.
export class BattleController {
  constructor(multiplayer,{onView,onAura,onMessage}) {
    Object.assign(this,{room:multiplayer,onView,onAura,onMessage});
    this.arena = {}; this.loaded = false; this.trackedId = ''; this.localCount = 0;
    this.lastSentCount = -1; this.lastScoreAt = 0; this.finalSent = false;
    this.sweeping = false; this.scoreWriting = null; this.lastViewPhase = ''; this.lastCooldown = 0;
  }
  async start() {
    await new Promise((resolve,reject) => {
      this.unsubscribe = this.room.sdk.onValue(this.room.reference('arena'),snapshot => {
        this.arena = snapshot.val() || {}; this.loaded = true;
        const id = busyFight(this.arena,this.room.self?.id);
        if (id && id !== this.trackedId) {
          this.trackedId = id; this.localCount = 0; this.lastSentCount = -1; this.finalSent = false; this.lastScoreAt = 0;
        }
        this.render(); resolve();
      },error => { reject(error); this.onMessage(error); });
    });
    this.timer = setInterval(() => this.tick(),80);
  }
  get current() { return this.arena.fights?.[this.trackedId]; }
  get locked() {
    const fight = this.current;
    return !!fight && !TERMINAL.includes(fight.status);
  }
  async transact(action) {
    if (!this.room.ready || !this.room.self || !this.loaded) throw new Error('Wait for your connection to the room to return.');
    const actor = this.room.self.id;
    this.arena = await transactArena(this.room,{...action,actor});
    const id = busyFight(this.arena,actor);
    if (id && id !== this.trackedId) {
      this.trackedId = id; this.localCount = 0; this.lastSentCount = -1; this.finalSent = false; this.lastScoreAt = 0;
    }
    this.render();
  }
  invite(target) { return this.transact({type:'invite',target,id:createId()}); }
  respond(accept) { return this.transact({type:accept ? 'accept':'decline',id:this.trackedId}); }
  cancel(reason='left') { return this.trackedId ? this.transact({type:'cancel',id:this.trackedId,reason}) : Promise.resolve(); }
  tap() {
    const fight = this.current, now = this.room.now();
    if (!this.room.ready || !fight || fight.status !== 'active' || now < fight.startAt || now >= fight.endAt || this.finalSent) return;
    this.localCount = Math.min(1000,this.localCount+1); this.render();
  }
  async sendScore(final=false) {
    if (!this.room.ready || !this.room.self || this.finalSent) return;
    if (this.scoreWriting) {
      if (!final) return;
      await this.scoreWriting;
    }
    const fight = this.current, id = this.trackedId, actor = this.room.self?.id;
    if (!actor || !fight || fight.status !== 'active' || this.finalSent) return;
    const count = this.localCount;
    if (!final && count === this.lastSentCount) return;
    const ref = this.room.reference(`arena/fights/${id}/scores/${actor}`);
    this.lastScoreAt = this.room.now();
    if (final) this.finalSent = true;
    this.scoreWriting = this.room.sdk.runTransaction(ref,current => {
      const score = nextScore(current,count,final,this.room.now(),fight);
      return score ? {...score,at:this.room.sdk.serverTimestamp()} : undefined;
    },{applyLocally:false}).then(result => {
      if (result.committed && this.trackedId === id) this.lastSentCount = count;
      else if (final && this.trackedId === id) this.finalSent = false;
    }).catch(error => {
      if (final && this.trackedId === id) this.finalSent = false;
      this.onMessage(error);
    }).finally(() => { this.scoreWriting = null; });
    await this.scoreWriting;
  }
  async sweep() {
    if (this.sweeping || !this.loaded || !this.room.ready || !this.room.self) return;
    const probe = structuredClone(this.arena);
    if (!sweepArena(probe,this.room.now(),this.room.players)) return;
    this.sweeping = true;
    try {
      await this.room.sdk.runTransaction(this.room.reference('arena'),value => {
        const arena = value || {};
        return sweepArena(arena,this.room.now(),this.room.players) ? arena : undefined;
      },{applyLocally:false});
    } catch (error) { this.onMessage(error); }
    finally { this.sweeping = false; }
  }
  tick() {
    const now = this.room.now(), fight = this.current;
    if (this.room.ready && fight?.status === 'active' && now >= fight.startAt && now <= fight.endAt+BATTLE.grace) {
      if (now >= fight.endAt) this.sendScore(true);
      else if (now-this.lastScoreAt >= 250) this.sendScore();
    }
    if (!this.lastSweep || now-this.lastSweep >= 1000) { this.lastSweep = now; this.sweep(); }
    this.render();
  }
  render() {
    const actor = this.room.self?.id, now = this.room.now(), fight = this.current;
    const aura = [];
    for (const item of Object.values(this.arena.fights || {})) {
      if (item.status === 'active' || (item.status === 'finished' && now-item.closedAt < 2500)) aura.push(item.from,item.to);
    }
    this.onAura(new Set(aura));
    const currentFight = busyFight(this.arena,actor);
    if (actor && this.room.ready && this.room.self.data.currentFight !== currentFight) {
      this.room.writeSelf({currentFight}).catch(error => this.onMessage(error));
    }
    let phase = 'idle';
    if (!this.room.ready && fight && !TERMINAL.includes(fight.status)) phase = 'offline';
    else if (fight) {
      if (fight.status === 'pending') phase = actor === fight.to ? 'invitation':'waiting';
      else if (fight.status === 'active') phase = now < fight.startAt ? 'countdown' : now < fight.endAt ? 'power':'settling';
      else if (now-fight.closedAt < BATTLE.cooldown) phase = fight.status;
    }
    this.onView({phase,fight,id:this.trackedId,actor,count:this.localCount,now,changed:phase !== this.lastViewPhase});
    this.lastViewPhase = phase;
  }
  dismiss() { if (!this.locked) { this.trackedId = ''; this.render(); } }
  destroy() { clearInterval(this.timer); this.unsubscribe?.(); }
}
