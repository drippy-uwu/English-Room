import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { initializeApp, deleteApp } from 'firebase/app';
import * as sdk from 'firebase/database';
import { Multiplayer } from '../multiplayer.js';
import { transactArena, BattleController } from '../battle.js';
import { BATTLE } from '../battle-state.js';

const projectId='demo-offline-lounge';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate,label,timeout=15000) {
  const start=Date.now();
  while(!predicate()) { if(Date.now()-start>timeout)throw Error('Timeout: '+label); await delay(30); }
}
const data = name=>({name,avatar:1,x:720,y:700,online:true,currentFight:'',lastSeen:sdk.serverTimestamp()});

test('Realtime Database rules, presence, concurrent invitations, scores and disconnect cleanup', {timeout:90000},async t=>{
  const env=await initializeTestEnvironment({projectId,database:{host:'127.0.0.1',port:9000,rules:await readFile('database.rules.json','utf8')}});
  const rooms=[], apps=[], controllers=[];
  try {
    const db=env.unauthenticatedContext().database();
    await t.test('allow validated demo records, reject malformed data and writes elsewhere',async()=>{
      await assertSucceeds(sdk.set(sdk.ref(db,'rooms/lounge/players/test-player'),data('Test')));
      for(const patch of [{name:''},{avatar:30},{x:-1},{y:10000},{extra:true}]) await assertFails(sdk.set(sdk.ref(db,'rooms/lounge/players/test-player'),{...data('Test'),...patch}));
      await assertFails(sdk.set(sdk.ref(db,'private/stuff'),true));
      await assertFails(sdk.update(sdk.ref(db,'rooms/lounge/players/test-player'),{reaction:{id:'r',emoji:'bad',at:sdk.serverTimestamp()}}));
      await assertSucceeds(sdk.remove(sdk.ref(db,'rooms/lounge/players/test-player')));
    });
    const errors=[];
    for(let i=0;i<3;i++) {
      const app=initializeApp({projectId,databaseURL:`https://${projectId}.firebaseio.com`},'client-'+i);
      apps.push(app); const clientDB=sdk.getDatabase(app); sdk.connectDatabaseEmulator(clientDB,'127.0.0.1',9000);
      const room=new Multiplayer({sdk,db:clientDB,path:'rooms/lounge'},{onPlayers(){},onConnection(){},onError:error=>errors.push(error)});
      rooms.push(room); await room.start();
    }
    const ids=[];
    await t.test('three independent sessions join and see positions and reactions',async()=>{
      for(let i=0;i<3;i++) ids.push(await rooms[i].join({name:['Ana','Brayan','Cleo'][i],avatar:i,x:720+i*50,y:700,currentFight:''}));
      await until(()=>rooms.every(room=>room.players.size===3),'all clients see three users');
      assert.equal(new Set(ids).size,3);
      await rooms[0].position(730,700);
      await until(()=>rooms[1].players.get(ids[0])?.x===730,'remote movement');
      await rooms[0].react('🔥');
      await until(()=>rooms[1].players.get(ids[0])?.reaction?.emoji==='🔥','remote reaction');
      await rooms[0].writeSelf({reaction:null});
      await until(()=>!rooms[1].players.get(ids[0])?.reaction,'reaction cleanup');
    });
    const transaction=transactArena;
    await t.test('decline closes the request and releases both participants',async()=>{
      await transaction(rooms[0],{type:'invite',id:'decline-me',actor:ids[0],target:ids[1]});
      await transaction(rooms[1],{type:'decline',id:'decline-me',actor:ids[1]});
      const arena=(await sdk.get(rooms[0].reference('arena'))).val();
      assert.equal(arena.fights['decline-me'].status,'declined');
      assert.equal(arena.slots[ids[0]].fightId,'');
    });
    let acceptedId;
    await t.test('crossed requests reserve only one battle, with both locks',async()=>{
      const actions=[{type:'invite',id:'one',actor:ids[0],target:ids[1]},{type:'invite',id:'two',actor:ids[1],target:ids[0]}];
      const results=await Promise.allSettled(actions.map((action,index)=>transaction(rooms[index],action)));
      assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
      const arena=(await sdk.get(rooms[0].reference('arena'))).val();
      acceptedId=arena.slots[ids[0]].fightId;
      assert.equal(arena.slots[ids[1]].fightId,acceptedId);
      await assert.rejects(transaction(rooms[2],{type:'invite',id:'third',actor:ids[2],target:ids[0]}),/pendiente/);
    });
    await t.test('accept shared countdown, synchronize score batches, finish and cooldown',async()=>{
      let fight=(await sdk.get(rooms[0].reference(`arena/fights/${acceptedId}`))).val();
      const recipient=ids.indexOf(fight.to);
      await transaction(rooms[recipient],{type:'accept',id:acceptedId,actor:fight.to});
      fight=(await sdk.get(rooms[0].reference(`arena/fights/${acceptedId}`))).val();
      assert.equal(fight.endAt-fight.startAt,5000);
      await assertFails(sdk.update(rooms[0].reference(`arena/fights/${acceptedId}/scores/${ids[0]}`),{count:4,at:sdk.serverTimestamp()}));
      await delay(Math.max(0,fight.startAt-Date.now()+80));
      await sdk.update(rooms[0].reference(`arena/fights/${acceptedId}/scores/${ids[0]}`),{count:24,at:sdk.serverTimestamp()});
      await sdk.update(rooms[1].reference(`arena/fights/${acceptedId}/scores/${ids[1]}`),{count:18,at:sdk.serverTimestamp()});
      await assertFails(sdk.update(rooms[0].reference(`arena/fights/${acceptedId}/scores/${ids[0]}`),{count:5,at:sdk.serverTimestamp()}));
      await delay(Math.max(0,fight.endAt-Date.now()+80));
      for(let i=0;i<2;i++) await sdk.update(rooms[i].reference(`arena/fights/${acceptedId}/scores/${ids[i]}`),{final:true,at:sdk.serverTimestamp()});
      await assertFails(sdk.update(rooms[0].reference(`arena/fights/${acceptedId}/scores/${ids[0]}`),{count:25,at:sdk.serverTimestamp()}));
      await transaction(rooms[0],{type:'sweep',actor:ids[0]});
      const arena=(await sdk.get(rooms[1].reference('arena'))).val();
      assert.equal(arena.fights[acceptedId].winner,ids[0]); assert.equal(arena.fights[acceptedId].status,'finished');
      assert.ok(arena.slots[ids[0]].cooldownUntil>Date.now());
      await assert.rejects(transaction(rooms[0],{type:'invite',id:'too-soon',actor:ids[0],target:ids[1]}),/Espera/);
    });
    await t.test('onDisconnect removes a session; remaining client cancels its active fight',async()=>{
      await delay(BATTLE.cooldown+100);
      await transaction(rooms[0],{type:'invite',id:'disconnect-fight',actor:ids[0],target:ids[1]});
      await transaction(rooms[1],{type:'accept',id:'disconnect-fight',actor:ids[1]});
      sdk.goOffline(rooms[1].db);
      await until(()=>!rooms[0].players.has(ids[1]),'server onDisconnect cleanup');
      await transaction(rooms[0],{type:'sweep',actor:ids[0]});
      const arena=(await sdk.get(rooms[0].reference('arena'))).val();
      assert.equal(arena.fights['disconnect-fight'].status,'canceled');
      assert.equal(arena.slots[ids[0]].fightId,'');
      sdk.goOnline(rooms[1].db);
      await until(()=>rooms[0].players.has(ids[1])&&rooms[1].ready,'presence rearmed on reconnect');
    });
    await t.test('20 independent clients receive the same count and position updates',async()=>{
      const added=await Promise.all(Array.from({length:17},async(_,index)=>{
        const i=index+3, app=initializeApp({projectId,databaseURL:`https://${projectId}.firebaseio.com`},'client-'+i);
        apps.push(app); const clientDB=sdk.getDatabase(app); sdk.connectDatabaseEmulator(clientDB,'127.0.0.1',9000);
        const room=new Multiplayer({sdk,db:clientDB,path:'rooms/lounge'},{onPlayers(){},onConnection(){},onError:error=>errors.push(error)});
        rooms.push(room); await room.start();
        await room.join({name:'Player '+i,avatar:i%24,x:300+(i%5)*170,y:600+Math.floor(i/5)*75,currentFight:''});
        return room;
      }));
      assert.equal(added.length,17);
      await until(()=>rooms.every(room=>room.players.size===20),'all 20 clients see the same count');
      for(let round=0;round<3;round++) await Promise.all(rooms.map((room,i)=>room.position(300+(i%5)*170+round,600+Math.floor(i/5)*75)));
      await until(()=>rooms.every(room=>room.players.get(ids[0])?.x===302),'20-client movement fanout');
    });
    await t.test('actual BattleController runs the timed tapping game on two independent clients',async()=>{
      // The fanout scenario spread users across the room; bring this pair next to each other.
      await rooms[1].position(390,600);
      await until(()=>rooms.slice(0,2).every(room=>room.players.get(ids[1])?.x===390),'nearby battle pair');
      const arena=(await sdk.get(rooms[0].reference('arena'))).val() || {};
      const cooldown=Math.max(arena.slots?.[ids[0]]?.cooldownUntil || 0,arena.slots?.[ids[1]]?.cooldownUntil || 0);
      await delay(Math.max(0,cooldown-Date.now()+80));
      for(const room of rooms.slice(0,2)) {
        const controller=new BattleController(room,{onView(){},onAura(){},onMessage:error=>errors.push(error)});
        controllers.push(controller); await controller.start();
      }
      await controllers[0].invite(ids[1]);
      await until(()=>controllers[1].current?.status==='pending','recipient gets request');
      await controllers[1].respond(true);
      await until(()=>controllers[0].current?.status==='active','both clients get shared start');
      const fight=controllers[0].current;
      controllers[0].tap(); assert.equal(controllers[0].localCount,0);
      await delay(Math.max(0,fight.startAt-Date.now()+80));
      for(let i=0;i<24;i++)controllers[0].tap();
      for(let i=0;i<18;i++)controllers[1].tap();
      await until(()=>controllers.every(controller=>controller.current?.status==='finished'),'same final result',15000);
      assert.equal(controllers[0].current.winner,ids[0]);
      assert.equal(controllers[1].current.winner,ids[0]);
      assert.equal(controllers[0].current.scores[ids[0]].count,24);
      assert.equal(controllers[0].current.scores[ids[1]].count,18);
      controllers[0].tap(); assert.equal(controllers[0].localCount,24);
    });
    assert.deepEqual(errors,[]);
  } finally {
    controllers.forEach(controller=>controller.destroy());
    for(const room of rooms){await room.leave();room.destroy()}
    for(const app of apps)await deleteApp(app);
    await env.cleanup();
  }
});
