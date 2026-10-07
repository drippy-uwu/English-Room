// DOM/state smoke checks, not a browser rendering test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { near, busyFight, BATTLE } from '../battle-state.js';
import { REACTIONS } from '../multiplayer.js';

class Element {
  constructor() {
    this.children=[];this.style={};this.attributes={};this.events={};this.dataset={};
    this.hidden=false;this.disabled=false;this.value='';this.className='';this.open=false;
    this.firstChild={textContent:''};
    this.classList={add:name=>this.toggleClass(name,true),remove:name=>this.toggleClass(name,false),toggle:(name,value)=>this.toggleClass(name,value)};
  }
  toggleClass(name,value){const set=new Set(this.className.split(' ').filter(Boolean));value?set.add(name):set.delete(name);this.className=[...set].join(' ')}
  append(...children){for(const child of children){child.parent=this;this.children.push(child)}}
  setAttribute(key,value){this.attributes[key]=String(value)}
  addEventListener(name,callback){(this.events[name]??=[]).push(callback)}
  async fire(name,event={}){for(const callback of this.events[name]||[])await callback({target:this,preventDefault(){},...event})}
  querySelector(selector){return this.children.find(child=>selector.startsWith('.')&&child.className.split(' ').includes(selector.slice(1)))||null}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this)}
  replaceChildren(){this.children=[]}
  focus(){}
  setCustomValidity(message){this.validity=message}
  reportValidity(){}
  getBoundingClientRect(){return {left:0,top:0,right:this.clientWidth,bottom:this.clientHeight}}
  showModal(){this.open=true}
  close(){this.open=false}
  closest(selector){let element=this;while(element){if(selector.startsWith('.')&&element.className.split(' ').includes(selector.slice(1)))return element;element=element.parent}return null}
  setPointerCapture(id){this.captured=id}
  hasPointerCapture(id){return this.captured===id}
  releasePointerCapture(){this.captured=null}
}
test('original room renderer integrates real participants, mobile camera and all battle phases',{timeout:5000},async()=>{
  const html=await readFile('index.html','utf8');
  let script=await readFile('script.js','utf8');
  const elements=Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(match=>['#'+match[1],new Element()]));
  elements['.join-button']=new Element();
  const reactionButtons=REACTIONS.filter(x=>x!=='👋').map(reaction=>{const element=new Element();element.dataset.reaction=reaction;return element});
  const zoneButtons=['lounge','floor','music'].map(zone=>{const element=new Element();element.dataset.zone=zone;return element});
  elements['#room'].clientWidth=354;elements['#room'].clientHeight=450;
  let tick=0,frameId=0,mobile=true;const frames=new Map();
  const multiplayer={
    players:new Map(),self:null,now:()=>Date.now(),
    async join(data){this.self={id:'local',data};this.players.set('local',{...data,online:true,lastSeen:Date.now()});return 'local'},
    async position(x,y){this.players.get('local').x=x;this.players.get('local').y=y},
    async react(){},async writeSelf(){},async leave(){this.players.delete('local');this.self=null}
  };
  const invites=[];
  const battle={loaded:true,locked:false,arena:{},trackedId:'',localCount:0,dismiss(){},sweep(){},async invite(id){invites.push(id)}};
  const context=vm.createContext({
    document:{querySelector:selector=>{assert.ok(elements[selector],`Missing DOM hook ${selector}`);return elements[selector]},querySelectorAll:selector=>selector==='[data-reaction]'?reactionButtons:zoneButtons,createElement:()=>new Element(),createElementNS:()=>new Element()},
    matchMedia:query=>({get matches(){return query.includes('760')?mobile:query.includes('reduced')}}),
    performance:{now:()=>tick},requestAnimationFrame:fn=>{const id=++frameId;frames.set(id,fn);return id},cancelAnimationFrame:id=>frames.delete(id),
    setTimeout:()=>1,clearTimeout(){},ResizeObserver:class{observe(){}},REACTIONS,BATTLE,near,busyFight,
    console,multiplayerFake:multiplayer,battleFake:battle
  });
  script=script.replace(/^import[^\n]+\n/gm,'').replace('\ninitializeMultiplayer();','\n');
  const run=source=>vm.runInContext(source,context);
  const flush=()=>{for(let i=0;frames.size&&i<100;i++){tick+=20;const pending=[...frames.values()];frames.clear();pending.forEach(frame=>frame(tick))}assert.equal(frames.size,0)};
  run(script);run('multiplayer=multiplayerFake; battle=battleFake; connectionReady=true;');
  assert.equal(elements['#avatars'].children.length,0);
  elements['#name'].value=' ';await elements['#join-form'].fire('submit');assert.equal(run('player'),null);
  elements['#name'].value='Brayan';await elements['#join-form'].fire('submit');
  assert.equal(elements['#avatars'].children.length,1);assert.equal(elements['#online-count'].textContent,'1 en la sala');
  assert.ok(elements['#join-overlay'].hidden);assert.ok(!elements['#room'].inert);
  multiplayer.players.set('remote',{name:'Ana',avatar:3,x:790,y:700,online:true,lastSeen:Date.now()});
  run('syncPlayers(multiplayer.players)');assert.equal(elements['#avatars'].children.length,2);
  assert.equal(elements['#online-count'].textContent,'2 en la sala');
  run('player.x=720;player.y=700;positionAvatar(player);interact(remotePlayers.get("remote"))');
  assert.ok(elements['#interaction-dialog'].open);
  multiplayer.players.get('remote').x=870;
  run('syncPlayers(multiplayer.players)'); // Shared position changed before the visual interpolation finishes.
  await elements['#challenge-button'].fire('click');
  assert.deepEqual(invites,[]);assert.ok(!elements['#interaction-dialog'].open);
  assert.match(elements['#toast'].textContent,/Acércate/);
  flush();run('interact(remotePlayers.get("remote"))');
  assert.ok(!elements['#interaction-dialog'].open); // Old 150-unit reach no longer opens Fight.
  multiplayer.players.get('remote').x=820;run('syncPlayers(multiplayer.players)');flush();
  run('interact(remotePlayers.get("remote"))');assert.ok(elements['#interaction-dialog'].open);
  await elements['#challenge-button'].fire('click');
  assert.deepEqual(invites,['remote']);assert.ok(!elements['#interaction-dialog'].open);
  for(const [width,height]of[[298,400],[354,450],[394,500],[708,480],[768,420],[1000,650],[1288,730]]){
    elements['#room'].clientWidth=width;elements['#room'].clientHeight=height;mobile=width<740;
    run('followPlayer(false)');if(mobile)assert.ok(run('camera.scale*60')>=44);
    for(const [x,y]of[[0,0],[720,640],[1440,960]]){
      run(`movePlayer(${x},${y})`);flush();assert.ok(run('isFree(player.x,player.y)'));
      const px=run('player.x*camera.scale+camera.x'),py=run('player.y*camera.scale+camera.y'),scale=run('camera.scale');
      assert.ok(px-30*scale>=0&&px+30*scale<=width);
      assert.ok(py-125*scale>=0&&py<=height);
    }
  }
  run('renderPeopleList()');assert.equal(elements['#people-list'].children.length,2);
  const fight={from:'local',to:'remote',name1:'Brayan',name2:'Ana',avatar1:0,avatar2:3,status:'active',startAt:10000,endAt:15000,closedAt:16000,winner:'local',scores:{local:{count:24,final:true},remote:{count:18,final:true}}};
  context.testFight=fight;
  for(const phase of ['invitation','waiting','countdown','power','settling','finished','declined','expired','canceled','offline']){
    run(`renderBattle({phase:'${phase}',fight:testFight,actor:'local',count:24,now:11000,changed:true})`);
    assert.ok(elements['#battle-dialog'].open);
    assert.equal(elements['#power-button'].disabled,phase!=='power');
    assert.equal(elements['#accept-fight'].hidden,phase!=='invitation');
  }
  run('renderBattle({phase:"idle",actor:"local"})');assert.ok(!elements['#battle-dialog'].open);
  multiplayer.players.delete('remote');run('syncPlayers(multiplayer.players)');
  assert.equal(elements['#avatars'].children.length,1);
  await elements['#leave'].fire('click');assert.equal(elements['#avatars'].children.length,0);assert.ok(!elements['#join-overlay'].hidden);
  assert.ok(elements['#room'].inert);
});
