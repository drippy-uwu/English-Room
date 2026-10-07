// Pure state transitions: the same decisions are used by Firebase transactions and tests.
// Room coordinates, independent of camera zoom: about two 60-unit avatar widths.
export const BATTLE = Object.freeze({ distance:110, invitation:15000, countdown:3000, duration:5000, grace:4000, cooldown:5000, retention:15000 });
export const TERMINAL = ['finished','declined','expired','canceled'];
export const busyFight = (arena,id) => arena?.slots?.[id]?.fightId || '';
export const near = (a,b) => !!a && !!b && Math.hypot(a.x-b.x,a.y-b.y) <= BATTLE.distance;

function release(arena,id,fight,now,cooldown) {
  for (const playerId of [fight.from,fight.to]) {
    if (arena.slots[playerId]?.fightId === id) {
      arena.slots[playerId] = { fightId:'', cooldownUntil:cooldown ? now+BATTLE.cooldown : 0 };
    }
  }
}
function close(arena,id,status,reason,now) {
  const fight = arena.fights[id];
  const wasActive = fight.status === 'active';
  Object.assign(fight,{status,reason,closedAt:now});
  release(arena,id,fight,now,wasActive);
}
export function sweepArena(arena,now,players) {
  let changed = false;
  arena.fights ||= {}; arena.slots ||= {};
  for (const [id,fight] of Object.entries(arena.fights)) {
    if (TERMINAL.includes(fight.status)) {
      if (now-fight.closedAt >= BATTLE.retention) { delete arena.fights[id]; changed = true; }
      continue;
    }
    if (players && (!players.has(fight.from) || !players.has(fight.to))) {
      close(arena,id,'canceled','disconnected',now); changed = true; continue;
    }
    if (fight.status === 'pending' && now >= fight.expiresAt) {
      close(arena,id,'expired','timeout',now); changed = true; continue;
    }
    if (fight.status === 'active' && now >= fight.endAt) {
      const a = fight.scores?.[fight.from], b = fight.scores?.[fight.to];
      if (a?.final && b?.final) {
        fight.winner = a.count === b.count ? 'draw' : a.count > b.count ? fight.from : fight.to;
        close(arena,id,'finished','',now); changed = true;
      } else if (now >= fight.endAt+BATTLE.grace) {
        close(arena,id,'canceled','scores-timeout',now); changed = true;
      }
    }
  }
  for (const [id,slot] of Object.entries(arena.slots)) {
    if (slot.fightId && !arena.fights[slot.fightId]) { delete arena.slots[id]; changed = true; }
    else if (!slot.fightId && slot.cooldownUntil <= now) { delete arena.slots[id]; changed = true; }
  }
  return changed;
}

export function applyArenaAction(value,action,now,players) {
  const arena = structuredClone(value || {fights:{},slots:{}});
  sweepArena(arena,now,players);
  if (action.type === 'invite') {
    const {actor,target,id} = action;
    if (!actor || !target || actor === target) throw new Error('No puedes desafiarte a ti mismo.');
    if (!players?.has(actor) || !players.has(target)) throw new Error('Ese jugador ya no está conectado.');
    if (!near(players.get(actor),players.get(target))) throw new Error('Acércate para desafiar a este jugador.');
    for (const pid of [actor,target]) {
      if (busyFight(arena,pid)) throw new Error('Ya hay una invitación o batalla pendiente.');
      if ((arena.slots[pid]?.cooldownUntil || 0) > now) throw new Error('Espera unos segundos antes de otra batalla.');
    }
    if (arena.fights[id]) throw new Error('La invitación ya existe.');
    const a = players.get(actor), b = players.get(target);
    arena.fights[id] = {
      from:actor,to:target,name1:a.name,name2:b.name,avatar1:a.avatar,avatar2:b.avatar,
      status:'pending',createdAt:now,expiresAt:now+BATTLE.invitation,startAt:0,endAt:0,
      closedAt:0,winner:'',reason:'',
      scores:{[actor]:{count:0,final:false,at:now},[target]:{count:0,final:false,at:now}}
    };
    // One parent transaction claims BOTH participants. Crossed invitations cannot win twice.
    arena.slots[actor] = {fightId:id,cooldownUntil:0};
    arena.slots[target] = {fightId:id,cooldownUntil:0};
    return arena;
  }
  if (action.type === 'sweep') return arena;
  const fight = arena.fights[action.id];
  if (!fight || ![fight.from,fight.to].includes(action.actor)) throw new Error('La invitación ya no está disponible.');
  if (action.type === 'accept') {
    if (action.actor !== fight.to || fight.status !== 'pending') throw new Error('Esta invitación ya fue respondida.');
    if (!near(players?.get(fight.from),players?.get(fight.to))) throw new Error('Acérquense antes de iniciar la batalla.');
    fight.status = 'active';
    fight.startAt = now+BATTLE.countdown;
    fight.endAt = fight.startAt+BATTLE.duration;
  } else if (action.type === 'decline') {
    if (action.actor !== fight.to || fight.status !== 'pending') throw new Error('Esta invitación ya fue respondida.');
    close(arena,action.id,'declined','declined',now);
  } else if (action.type === 'cancel') {
    if (!TERMINAL.includes(fight.status)) close(arena,action.id,'canceled',action.reason || 'left',now);
  } else throw new Error('Acción de batalla inválida.');
  return arena;
}

export function nextScore(current,count,final,now,fight) {
  if (!Number.isInteger(count) || count < 0 || count > 1000 || fight.status !== 'active'
    || now < fight.startAt || now > fight.endAt+BATTLE.grace || (!final && now >= fight.endAt)
    || (final && now < fight.endAt) || current?.final || count < (current?.count || 0)) return undefined;
  return {count,final,at:now};
}
