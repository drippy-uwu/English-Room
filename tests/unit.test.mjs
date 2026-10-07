import test from 'node:test';
import assert from 'node:assert/strict';
import { applyArenaAction, sweepArena, nextScore, BATTLE, near } from '../battle-state.js';
import { validPlayer, Multiplayer, createId } from '../multiplayer.js';

const record = (name,x=720,y=620) => ({name,avatar:0,x,y,online:true,lastSeen:Date.now(),currentFight:''});
const players = () => new Map([['a',record('Ana')],['b',record('Brayan',790)],['c',record('Cleo',730)]]);
const invite = (arena,id='fight-1',actor='a',target='b',now=10000,p=players()) => applyArenaAction(arena,{type:'invite',id,actor,target},now,p);
const accept = arena => applyArenaAction(arena,{type:'accept',id:'fight-1',actor:'b'},11000,players());

test('validates names, avatar and finite room coordinates', () => {
  assert.ok(validPlayer(record('Ana')));
  for (const patch of [{name:'   '},{name:'a'.repeat(19)},{avatar:24},{avatar:1.5},{x:Infinity},{y:90},{online:false},{lastSeen:null}]) assert.ok(!validPlayer({...record('Ana'),...patch}));
});
test('generates UUIDs on both HTTPS and insecure LAN previews', () => {
  assert.match(createId(),/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  const fallback={getRandomValues:array=>{array.fill(255);return array}};
  assert.equal(createId(fallback),'ffffffff-ffff-4fff-bfff-ffffffffffff');
});
test('reserves two slots atomically and rejects crossed or third-player requests', () => {
  const arena = invite(null);
  assert.equal(arena.slots.a.fightId,'fight-1'); assert.equal(arena.slots.b.fightId,'fight-1');
  assert.throws(() => invite(arena,'fight-2','b','a'),/pendiente/);
  assert.throws(() => invite(arena,'fight-3','c','a'),/pendiente/);
  assert.throws(() => invite(arena,'fight-4','a','a'),/mismo/);
});
test('rejects distant and disconnected targets', () => {
  const p=players(); p.get('b').x=1200;
  assert.ok(!near(p.get('a'),p.get('b')));
  assert.throws(() => invite(null,'fight-1','a','b',10000,p),/Acércate/);
  p.delete('b'); assert.throws(() => invite(null,'fight-1','a','b',10000,p),/conectado/);
});
test('only recipient can accept, accepting twice cannot create another fight', () => {
  const arena=invite(null);
  assert.throws(() => applyArenaAction(arena,{type:'accept',id:'fight-1',actor:'a'},11000,players()),/respondida/);
  const active=accept(arena); const fight=active.fights['fight-1'];
  assert.equal(fight.startAt,14000); assert.equal(fight.endAt,19000);
  assert.throws(() => accept(active),/respondida/);
});
test('decline releases both reservations; pending invitations expire', () => {
  const arena=applyArenaAction(invite(null),{type:'decline',id:'fight-1',actor:'b'},11000,players());
  assert.equal(arena.fights['fight-1'].status,'declined'); assert.equal(arena.slots.a.fightId,'');
  const expired=invite(null); assert.ok(sweepArena(expired,25000,players()));
  assert.equal(expired.fights['fight-1'].status,'expired');
  assert.ok(!expired.slots.a);
});
test('scores are monotonic, bounded, immutable when final and constrained to the shared window', () => {
  const fight=accept(invite(null)).fights['fight-1'];
  assert.equal(nextScore(null,3,false,13999,fight),undefined);
  assert.equal(nextScore(null,3,true,16000,fight),undefined);
  assert.deepEqual(nextScore(null,3,false,16000,fight),{count:3,final:false,at:16000});
  assert.equal(nextScore({count:8,final:false},7,false,16000,fight),undefined);
  assert.equal(nextScore(null,1001,false,16000,fight),undefined);
  assert.equal(nextScore(null,3,false,19000,fight),undefined);
  assert.ok(nextScore(null,3,true,19000,fight));
  assert.equal(nextScore({count:3,final:true},4,true,19001,fight),undefined);
  assert.equal(nextScore(null,3,true,23001,fight),undefined);
});
test('both final scores determine the same winner, then enforce cooldown', () => {
  const arena=accept(invite(null)), fight=arena.fights['fight-1'];
  fight.scores.a={count:24,final:true,at:19000}; fight.scores.b={count:18,final:true,at:19000};
  sweepArena(arena,19001,players()); assert.equal(fight.winner,'a'); assert.equal(fight.status,'finished');
  assert.throws(() => invite(arena,'fight-2','a','b',20000),/Espera/);
  assert.equal(invite(arena,'fight-2','a','b',24001).slots.a.fightId,'fight-2');
});
test('draw is explicit; missing final score cancels rather than inventing a winner', () => {
  const arena=accept(invite(null)), fight=arena.fights['fight-1'];
  fight.scores.a={count:10,final:true,at:19000}; fight.scores.b={count:10,final:true,at:19000};
  sweepArena(arena,19000,players()); assert.equal(fight.winner,'draw');
  const partial=accept(invite(null)); partial.fights['fight-1'].scores.a={count:9,final:true,at:19000};
  sweepArena(partial,23000,players()); assert.equal(partial.fights['fight-1'].reason,'scores-timeout');
});
test('disconnection cancels active fight, clears locks and terminal records expire', () => {
  const arena=accept(invite(null)), p=players(); p.delete('b');
  sweepArena(arena,15000,p); assert.equal(arena.fights['fight-1'].reason,'disconnected');
  assert.equal(arena.slots.a.fightId,'');
  sweepArena(arena,15000+BATTLE.retention,p); assert.ok(!arena.fights['fight-1']); assert.ok(!arena.slots.a);
});
test('presence arms cleanup before publishing and re-arms on reconnect', async () => {
  const calls=[]; let connected;
  const sdk={
    ref:(_,path)=>path,serverTimestamp:()=>12345,
    onValue:(path,callback)=>{if(path==='.info/connected')connected=callback;return()=>{}},
    onDisconnect:path=>({remove:async()=>calls.push(['onDisconnect',path]),cancel:async()=>calls.push(['cancel',path])}),
    set:async(path,data)=>calls.push(['set',path,data]),remove:async path=>calls.push(['remove',path]),update:async()=>{}
  };
  const room=new Multiplayer({sdk,db:{},path:'rooms/lounge'},{onPlayers(){},onConnection(){},onError(error){throw error}});
  room.connected=true; const id=await room.join({name:'Ana',avatar:0,x:720,y:825});
  assert.match(id,/^[0-9a-f-]{36}$/); assert.equal(calls[0][0],'onDisconnect'); assert.equal(calls[1][0],'set');
  await room.publishPresence(); assert.equal(calls[2][0],'onDisconnect'); assert.equal(calls[3][0],'set');
  await room.leave(); assert.equal(calls.at(-2)[0],'remove'); assert.equal(calls.at(-1)[0],'cancel');
});
