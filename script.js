import { connectFirebase, friendlyError } from './firebase.js';
import { Multiplayer, REACTIONS } from './multiplayer.js';
import { BattleController } from './battle.js';
import { BATTLE, near, busyFight } from './battle-state.js';

/* Existing room renderer. Realtime records never replace the original SVG design. */
const WORLD = { width: 1440, height: 960 };
const room = document.querySelector('#room');
const world = document.querySelector('#world');
const avatars = document.querySelector('#avatars');
const overlay = document.querySelector('#join-overlay');
const announcement = document.querySelector('#announcement');
const dialog = document.querySelector('#people-dialog');
const reactionButtons = [...document.querySelectorAll('[data-reaction]')];
const zoneButtons = [...document.querySelectorAll('[data-zone]')];
const compact = matchMedia('(max-width: 760px)');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const palette = [
  { shirt:'#557ed1', pants:'#243449', skin:'#cc9573', hair:'#292730' },
  { shirt:'#d5814c', pants:'#354052', skin:'#e5b796', hair:'#593c2e' },
  { shirt:'#71938c', pants:'#202d40', skin:'#a16a4b', hair:'#211c23' },
  { shirt:'#bd6370', pants:'#303c54', skin:'#e8c4a6', hair:'#463339' },
  { shirt:'#8c82b8', pants:'#273349', skin:'#bc865f', hair:'#32242b' },
  { shirt:'#ccab62', pants:'#39485b', skin:'#6e4636', hair:'#201d25' },
  { shirt:'#aab6c3', pants:'#2b3548', skin:'#deb08e', hair:'#866347' },
  { shirt:'#3c7c8d', pants:'#212b3c', skin:'#f0cfac', hair:'#302632' }
];
const zones = { lounge: { x:330, y:620 }, floor: { x:718, y:640 }, music: { x:1160, y:590 } };
// Keep destinations out of furniture. Route collision is intentionally out of scope.
const furniture = [
  { x:150, y:305, w:290, h:125 }, { x:145, y:429, w:112, h:108 },
  { x:314, y:436, w:137, h:94 }, { x:1000, y:306, w:319, h:152 },
  { x:147, y:692, w:255, h:110 }, { x:1025, y:660, w:245, h:145 },
  { x:90, y:319, w:75, h:54 }, { x:912, y:301, w:60, h:60 },
  { x:1284, y:778, w:68, h:60 }
];
let player = null;
let selected = null;
let walkingFrame = 0;
let cameraFrame = 0;
let pointer = null;
let camera = { x:0, y:0, scale:1, mode:'overview' };
let previewStyle = Math.floor(Math.random() * 24);
let multiplayer = null;
let joining = false;
let connectionReady = false;
let lastPositionSent = 0;
const neighbors = [];
const remotePlayers = new Map();
let toastTimer;
let battle = null;
let interactionTarget = null;
let battleActionPending = false;
const interactionDialog = document.querySelector('#interaction-dialog');
const battleDialog = document.querySelector('#battle-dialog');

function notify(message) {
  const toast = document.querySelector('#toast');
  toast.textContent = message; toast.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, 4000);
  announcement.textContent = message;
}

/* Original people with jackets, sneakers, varied hairstyles and accessories. */
function character(index) {
  const p = palette[index % palette.length];
  const hair = index % 3 === 0
    ? `<path d="M21 20V11Q31 1 42 10L44 22L38 18L36 11L24 15V22Z" fill="${p.hair}"/>`
    : index % 3 === 1
      ? `<path d="M21 29V12Q23 4 32 4Q43 4 44 15L45 31L39 28V14L24 15V29Z" fill="${p.hair}"/>`
      : `<path d="M21 18Q18 2 32 3Q48 3 44 20L39 14L24 15Z" fill="${p.hair}"/><path d="M21 10H43" stroke="${p.shirt}" stroke-width="4"/>`;
  const accessory = index % 4 === 0
    ? '<path d="M24 21H30V25H24ZM34 21H40V25H34ZM30 22H34" fill="none" stroke="#26354a" stroke-width="1.4"/>'
    : index % 4 === 1 ? '<path d="M21 37L32 49L43 37" fill="none" stroke="#e3dbca" stroke-width="3"/>' : '';
  return `<svg class="character" viewBox="0 0 64 100" aria-hidden="true"><ellipse cx="32" cy="94" rx="20" ry="5" fill="#111722" opacity=".6"/><path d="M25 61L24 85M39 61L41 85" stroke="${p.pants}" stroke-width="11"/><path d="M17 89H29M37 89H49" stroke="#d7dce2" stroke-width="7" stroke-linecap="round"/><path d="M22 36L13 58M42 36L51 58" stroke="${p.shirt}" stroke-width="9" stroke-linecap="round"/><path d="M12 59V63M52 59V63" stroke="${p.skin}" stroke-width="6" stroke-linecap="round"/><path d="M22 31H42L45 64H19Z" fill="${p.shirt}"/><path d="M32 35V64M21 52H27M37 52H43" stroke="#141e2b" stroke-opacity=".3" stroke-width="2"/><rect x="28" y="27" width="8" height="9" fill="${p.skin}"/><rect x="22" y="8" width="21" height="24" rx="7" fill="${p.skin}"/>${hair}<path d="M26 21V23M38 21V23" stroke="#302934" stroke-width="1.8" stroke-linecap="round"/><path d="M30 28H34" stroke="#8c5d4c" stroke-width="1.2"/>${accessory}</svg>`;
}

function positionAvatar(person) {
  person.element.style.left = `${person.x}px`;
  person.element.style.top = `${person.y}px`;
  person.element.style.zIndex = Math.round(person.y);
  person.mapDot.setAttribute('cx', person.x);
  person.mapDot.setAttribute('cy', person.y);
}
function selectPerson(person) {
  selected?.element.classList.remove('selected');
  selected?.button.setAttribute('aria-pressed', 'false');
  selected = person;
  person.element.classList.add('selected');
  person.button.setAttribute('aria-pressed', 'true');
  announcement.textContent = `${person.name}${person === player ? ', tú' : ''}`;
}
function makeAvatar(name, index, x, y, isYou = false) {
  const element = document.createElement('div');
  element.className = `avatar${isYou ? ' is-you' : ''}`;
  const button = document.createElement('button');
  button.className = 'avatar-hitbox';
  button.innerHTML = character(index);
  button.setAttribute('aria-label', `${name}${isYou ? ', tu personaje' : ', ver nombre'}`);
  button.setAttribute('aria-pressed', 'false');
  const label = document.createElement('span'); label.className = 'name-tag';
  label.textContent = name; // Names stay text: no user-provided HTML.
  if (isYou) {
    const you = document.createElement('span'); you.className = 'you-label'; you.textContent = 'TÚ'; label.append(you);
    const ring = document.createElement('span'); ring.className = 'player-ring'; element.append(ring);
  }
  element.append(button, label); avatars.append(element);
  const mapDot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  mapDot.setAttribute('r', isYou ? 23 : 15);
  mapDot.setAttribute('fill', isYou ? '#e98a5b' : '#9db6df');
  document.querySelector('#map-dots').append(mapDot);
  const person = { element, button, mapDot, x, y, name, index };
  button.addEventListener('click', () => {
    if (pointer?.dragged) return;
    selectPerson(person);
    interact(person);
  });
  positionAvatar(person);
  return person;
}

// Real users only. No decorative NPC enters the online count or battle logic.
document.querySelector('#preview-avatar').innerHTML = character(previewStyle);

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
function fitScale() { return Math.min(room.clientWidth / WORLD.width, room.clientHeight / WORLD.height); }
function normalScale() {
  // 60-unit hitboxes stay 51px wide on mobile, except in the optional overview.
  return compact.matches ? .85 : Math.max(.72, fitScale());
}
function boundedCamera(x, y, scale) {
  const width = WORLD.width * scale, height = WORLD.height * scale;
  return {
    x: width <= room.clientWidth ? (room.clientWidth - width) / 2 : clamp(x, room.clientWidth - width, 0),
    y: height <= room.clientHeight ? (room.clientHeight - height) / 2 : clamp(y, room.clientHeight - height, 0)
  };
}
function cameraTarget(person, scale) {
  // More headroom keeps the name and reaction visible while walking.
  return boundedCamera(room.clientWidth / 2 - person.x * scale, room.clientHeight * .62 - person.y * scale, scale);
}
function renderCamera() {
  world.style.transform = `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`;
  const mapCamera = document.querySelector('#map-camera');
  const left = clamp(-camera.x / camera.scale, 0, WORLD.width), top = clamp(-camera.y / camera.scale, 0, WORLD.height);
  mapCamera.setAttribute('x', left); mapCamera.setAttribute('y', top);
  mapCamera.setAttribute('width', Math.min(WORLD.width - left, room.clientWidth / camera.scale));
  mapCamera.setAttribute('height', Math.min(WORLD.height - top, room.clientHeight / camera.scale));
  document.querySelector('#overview').setAttribute('aria-pressed', String(camera.mode === 'overview'));
  document.querySelector('#camera-mode').textContent = { overview:'VISTA GENERAL', follow:'TE SIGUE', free:'EXPLORANDO' }[camera.mode];
}
function animateCamera(target, scale, mode, animate = true) {
  cancelAnimationFrame(cameraFrame);
  camera.mode = mode;
  if (!animate || reducedMotion.matches) { Object.assign(camera, target, { scale }); renderCamera(); return; }
  const start = { ...camera }, started = performance.now();
  function frame(now) {
    const progress = clamp((now - started) / 280, 0, 1), t = 1 - (1 - progress) ** 3;
    camera.x = start.x + (target.x - start.x) * t;
    camera.y = start.y + (target.y - start.y) * t;
    camera.scale = start.scale + (scale - start.scale) * t;
    renderCamera();
    if (progress < 1) cameraFrame = requestAnimationFrame(frame);
  }
  cameraFrame = requestAnimationFrame(frame);
}
function followPlayer(animate = true) {
  if (!player) return;
  const scale = normalScale(); animateCamera(cameraTarget(player, scale), scale, 'follow', animate);
}
function overview(animate = true) {
  const scale = fitScale(); animateCamera(boundedCamera(0,0,scale), scale, 'overview', animate);
}
document.querySelector('#overview').addEventListener('click', () => {
  if (camera.mode === 'overview' && player) followPlayer(); else overview();
});
document.querySelector('#recenter').addEventListener('click', () => followPlayer());

function isFree(x, y) {
  const inside = x >= 125 && x <= 1315 && y >= 360 && y <= 845;
  const blocked = furniture.some(item => x > item.x - 25 && x < item.x + item.w + 25 && y > item.y - 15 && y < item.y + item.h + 20);
  // Enough space between feet to prevent two bodies landing on top of each other.
  const occupied = neighbors.some(person => ((x-person.x)/67)**2 + ((y-person.y)/83)**2 < 1);
  return inside && !blocked && !occupied;
}
function freeDestination(x, y) {
  x = clamp(x,125,1315); y = clamp(y,360,845);
  if (isFree(x,y)) return {x,y};
  // Find the closest available point around a tapped object or occupied place.
  for (let radius = 20; radius <= 1450; radius += 20) {
    for (let step = 0; step < 24; step++) {
      const angle = step / 24 * Math.PI * 2;
      const candidate = {x:x+Math.cos(angle)*radius, y:y+Math.sin(angle)*radius};
      if (isFree(candidate.x,candidate.y)) return candidate;
    }
  }
  return player ? {x:player.x,y:player.y} : {x:720,y:825};
}
function setJoined(joined) {
  overlay.hidden = joined;
  room.inert = !joined; // Keep keyboard focus out of the scene until joining.
  document.querySelector('#leave').disabled = !joined;
  document.querySelector('#recenter').disabled = !joined;
  reactionButtons.forEach(button => button.disabled = !joined);
  zoneButtons.forEach(button => button.disabled = !joined);
  updateOnlineCount();
}
document.querySelector('#join-form').addEventListener('submit', async event => {
  event.preventDefault(); if (player || joining) return;
  const input = document.querySelector('#name'), name = input.value.trim();
  if (!name) { input.setCustomValidity('Escribe tu nombre para entrar.'); input.reportValidity(); return; }
  if (!multiplayer || !connectionReady || !battle?.loaded) { notify('La sala aún no está lista. Revisa el mensaje de conexión.'); return; }
  joining = true;
  const submit = document.querySelector('.join-button'); submit.disabled = true; submit.firstChild.textContent = 'Entrando… ';
  try {
  const spawn = freeDestination(550 + Math.random()*340,790 + Math.random()*55);
  const id = await multiplayer.join({ name, avatar:previewStyle, x:Math.round(spawn.x), y:Math.round(spawn.y), currentFight:'' });
  player = makeAvatar(name,previewStyle,spawn.x,spawn.y,true); player.id = id;
  battle.trackedId = ''; battle.localCount = 0;
  const duplicate = remotePlayers.get(id);
  if (duplicate) { removeRemote(duplicate); remotePlayers.delete(id); }
  setJoined(true);
  document.querySelector('#identity-avatar').innerHTML = character(previewStyle);
  document.querySelector('#identity-name').textContent = name;
  document.querySelector('#identity-status').textContent = 'En la sala · Este eres tú';
  if (compact.matches) followPlayer(false); else overview(false);
  room.focus({preventScroll:true});
  announcement.textContent = `Bienvenido, ${name}. Toca el suelo para caminar.`;
  } catch (error) { showJoinError(error); }
  finally { joining = false; submit.disabled = false; submit.firstChild.textContent = 'Join the Room '; }
});
document.querySelector('#name').addEventListener('input', event => event.target.setCustomValidity(''));

// Feet and camera use the same animated position, so taps stay in world coordinates.
function movePlayer(x,y) {
  if (!player || !connectionReady || battle?.locked) return;
  cancelAnimationFrame(walkingFrame); cancelAnimationFrame(cameraFrame);
  const target = freeDestination(x,y), person = player;
  const start = {x:person.x,y:person.y}, started = performance.now();
  const duration = reducedMotion.matches ? 0 : clamp(Math.hypot(target.x-start.x,target.y-start.y)*1.7,200,1000);
  if (camera.mode !== 'overview') camera.mode = 'follow';
  const marker = document.querySelector('#move-marker'); marker.hidden = false;
  marker.style.left = `${target.x}px`; marker.style.top = `${target.y}px`;
  marker.style.animation = 'none'; void marker.offsetWidth; marker.style.animation = '';
  person.element.classList.add('walking');
  function frame(now) {
    const t = duration ? clamp((now-started)/duration,0,1) : 1, eased = t*t*(3-2*t);
    person.x = start.x + (target.x-start.x)*eased; person.y = start.y + (target.y-start.y)*eased;
    positionAvatar(person);
    // Maximum five position writes per second, plus the final destination.
    if (now-lastPositionSent >= 200 || t === 1) {
      lastPositionSent = now;
      multiplayer.position(person.x,person.y).catch(error => notify(friendlyError(error)));
    }
    if (camera.mode === 'follow') { Object.assign(camera,cameraTarget(person,camera.scale)); renderCamera(); }
    if (t < 1) walkingFrame = requestAnimationFrame(frame);
    else { person.element.classList.remove('walking'); marker.hidden = true; }
  }
  walkingFrame = requestAnimationFrame(frame);
}

/* Tap = move. Horizontal drag = explore. Vertical gestures keep native page scroll.
   This avoids trapping the user inside the room on a phone. */
room.addEventListener('pointerdown', event => {
  if (!player || event.button !== 0 || event.target.closest('.viewport-tools')) return;
  pointer = { id:event.pointerId, x:event.clientX, y:event.clientY, cameraX:camera.x, cameraY:camera.y, dragged:false, vertical:false, avatar:event.target.closest('.avatar') };
});
room.addEventListener('pointermove', event => {
  if (!pointer || pointer.id !== event.pointerId) return;
  const dx = event.clientX-pointer.x, dy = event.clientY-pointer.y;
  if (!pointer.dragged && Math.hypot(dx,dy) > 9) {
    if (event.pointerType === 'touch' && Math.abs(dy) > Math.abs(dx)) { pointer.vertical = true; return; }
    if (pointer.vertical) return;
    pointer.dragged = true; room.setPointerCapture(event.pointerId);
    cancelAnimationFrame(cameraFrame); camera.mode = 'free';
  }
  if (pointer.dragged) { Object.assign(camera,boundedCamera(pointer.cameraX+dx,pointer.cameraY+dy,camera.scale)); renderCamera(); }
});
room.addEventListener('pointerup', event => {
  if (!pointer || pointer.id !== event.pointerId) return;
  if (!pointer.dragged && !pointer.vertical && !pointer.avatar) {
    const rect = room.getBoundingClientRect();
    movePlayer((event.clientX-rect.left-camera.x)/camera.scale,(event.clientY-rect.top-camera.y)/camera.scale);
    selected?.element.classList.remove('selected'); selected?.button.setAttribute('aria-pressed','false'); selected = null;
  }
  if (room.hasPointerCapture(event.pointerId)) room.releasePointerCapture(event.pointerId);
  // Preserve drag state through the synthesized click to avoid accidental selection.
  setTimeout(() => { if (pointer?.id === event.pointerId) pointer = null; },0);
});
room.addEventListener('pointercancel', () => { pointer = null; });
room.addEventListener('keydown', event => {
  if (event.target !== room) return;
  const moves = {ArrowLeft:[-65,0],ArrowRight:[65,0],ArrowUp:[0,-65],ArrowDown:[0,65]};
  if (!player || !moves[event.key]) return;
  event.preventDefault(); const [x,y] = moves[event.key]; movePlayer(player.x+x,player.y+y);
});
zoneButtons.forEach(button => button.addEventListener('click', () => {
  if (!player) return;
  const zone = zones[button.dataset.zone]; camera.mode = 'follow'; camera.scale = normalScale(); movePlayer(zone.x,zone.y);
}));

function showReaction(person,emoji) {
  person.element.querySelector('.bubble')?.remove();
  const bubble = document.createElement('span'); bubble.className = 'bubble'; bubble.textContent = emoji;
  person.element.append(bubble); setTimeout(() => bubble.remove(),2200);
}
let lastReaction = 0;
reactionButtons.forEach(button => button.addEventListener('click', async () => {
  if (!player || !connectionReady || Date.now()-lastReaction < 300) return;
  lastReaction = Date.now();
  try {
    await multiplayer.react(button.dataset.reaction);
    // The listener displays it for all users, including this client.
  } catch (error) { notify(friendlyError(error)); }
}));

function renderPeopleList() {
  const list = document.querySelector('#people-list'); list.replaceChildren();
  document.querySelector('#people-summary').textContent = `${multiplayer?.players.size || 0} participantes conectados`;
  const sorted = player ? [player,...neighbors] : neighbors;
  sorted.forEach(person => {
    const row = document.createElement('li');
    const portrait = document.createElement('span'); portrait.className = 'list-avatar'; portrait.innerHTML = character(person.index);
    const name = document.createElement('span'); name.className = 'list-name'; name.textContent = person.name;
    const status = document.createElement('small'); status.textContent = person === player ? 'Tú' : 'En la sala'; name.append(status);
    const button = document.createElement('button'); button.textContent = 'Ver'; button.setAttribute('aria-label',`Ver a ${person.name}`);
    button.addEventListener('click', () => {
      dialog.close(); selectPerson(person);
      const scale = normalScale(); animateCamera(cameraTarget(person,scale),scale,'free');
    });
    row.append(portrait,name,button); list.append(row);
  });
}
document.querySelector('#people-button').addEventListener('click', () => { renderPeopleList(); dialog.showModal(); });
document.querySelector('#close-people').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', event => {
  const rect = dialog.getBoundingClientRect();
  if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
});

document.querySelector('#leave').addEventListener('click', async () => {
  if (battle?.locked && connectionReady) {
    try { await battle.cancel('left'); } catch (error) { notify(friendlyError(error)); }
  }
  cancelAnimationFrame(walkingFrame); cancelAnimationFrame(cameraFrame);
  selected?.element.classList.remove('selected'); selected?.button.setAttribute('aria-pressed','false'); selected = null; pointer = null;
  player?.element.remove(); player?.mapDot.remove(); player = null;
  battle?.dismiss();
  clearTimeout(toastTimer);
  await multiplayer?.leave();
  setJoined(false); previewStyle = Math.floor(Math.random()*24);
  document.querySelector('#preview-avatar').innerHTML = character(previewStyle);
  document.querySelector('#identity-avatar').textContent = '—';
  document.querySelector('#identity-name').textContent = 'Tu personaje';
  document.querySelector('#identity-status').textContent = 'Un estilo al azar. Tú decides el nombre.';
  document.querySelector('#move-marker').hidden = true; overview(false);
  document.querySelector('#name').focus({preventScroll:true}); announcement.textContent = 'Saliste de la sala. Puedes volver cuando quieras.';
});

new ResizeObserver(() => {
  if (camera.mode === 'overview' || !player) overview(false);
  else if (camera.mode === 'follow') followPlayer(false);
  else { const scale = normalScale(); animateCamera(cameraTarget(selected || player,scale),scale,'free',false); }
}).observe(room);
overview(false);
if (matchMedia('(pointer:coarse)').matches) document.querySelector('#room-instruction').textContent = 'Toca para caminar · Arrastra ↔ para explorar';

function updateOnlineCount() {
  const count = multiplayer?.players.size || 0;
  document.querySelector('#online-count').textContent = `${count} en la sala`;
  document.querySelector('#join-count').textContent = count ? `${count} en la sala` : 'Sé el primero en entrar';
}
function removeRemote(person) {
  cancelAnimationFrame(person.animationFrame);
  clearTimeout(person.reactionTimer);
  person.element.remove(); person.mapDot.remove();
  const index = neighbors.indexOf(person); if (index >= 0) neighbors.splice(index,1);
  if (selected === person) { selected = null; notify('Ese jugador salió de la sala.'); }
  if (interactionTarget === person.id) { interactionTarget = null; interactionDialog.close(); }
}
function animateRemote(person,x,y) {
  if (person.targetX === x && person.targetY === y) return;
  cancelAnimationFrame(person.animationFrame);
  person.targetX = x; person.targetY = y;
  const start = {x:person.x,y:person.y}, started = performance.now();
  person.element.classList.add('walking');
  function frame(now) {
    const t = reducedMotion.matches ? 1 : Math.min((now-started)/210,1);
    person.x = start.x+(x-start.x)*t; person.y = start.y+(y-start.y)*t; positionAvatar(person);
    if (t < 1) person.animationFrame = requestAnimationFrame(frame);
    else person.element.classList.remove('walking');
  }
  person.animationFrame = requestAnimationFrame(frame);
}
function syncPlayers(records) {
  for (const [id,person] of remotePlayers) if (!records.has(id) || id === player?.id) { removeRemote(person); remotePlayers.delete(id); }
  for (const [id,record] of records) {
    if (id === player?.id) { syncReaction(player,record.reaction); continue; }
    if (id === multiplayer?.self?.id) continue;
    let person = remotePlayers.get(id);
    if (!person) {
      person = makeAvatar(record.name,record.avatar,record.x,record.y); person.id = id;
      remotePlayers.set(id,person); neighbors.push(person);
    } else animateRemote(person,record.x,record.y);
    syncReaction(person,record.reaction);
  }
  updateOnlineCount();
  if (dialog.open) renderPeopleList();
  battle?.sweep();
}
function syncReaction(person,reaction) {
  if (!reaction || reaction.id === person.lastReactionID || !REACTIONS.includes(reaction.emoji)) return;
  person.lastReactionID = reaction.id;
  const age = multiplayer.now()-reaction.at;
  if (!Number.isFinite(age) || age < -3000 || age > 2500) return;
  showReaction(person,reaction.emoji);
  if (person === player) {
    const id = person.id;
    clearTimeout(person.reactionTimer);
    person.reactionTimer = setTimeout(() => {
      if (player?.id === id && multiplayer.self?.data.reaction?.id === reaction.id) {
        multiplayer.writeSelf({reaction:null}).catch(error => notify(friendlyError(error)));
      }
    },Math.max(0,2500-age));
  }
}
function showJoinError(error) {
  const message = friendlyError(error), target = document.querySelector('#join-error');
  target.textContent = message; target.hidden = false;
  document.querySelector('#connection-status').textContent = 'SIN CONEXIÓN';
  if (player) notify(message);
}
async function initializeMultiplayer() {
  try {
    const connection = await connectFirebase();
    multiplayer = new Multiplayer(connection, {
      onPlayers:syncPlayers,
      onConnection:({ready}) => {
        connectionReady = ready;
        document.querySelector('#connection-status').textContent = ready ? 'EN LÍNEA' : 'RECONECTANDO…';
        if (ready) document.querySelector('#join-error').hidden = true;
        if (player) {
          if (!ready) { cancelAnimationFrame(walkingFrame); player.element.classList.remove('walking'); }
          reactionButtons.forEach(button => button.disabled = !ready);
          zoneButtons.forEach(button => button.disabled = !ready);
          document.querySelector('#identity-status').textContent = ready ? 'En la sala · Este eres tú' : 'Sin conexión · Esperando…';
        }
      },
      onError:showJoinError
    });
    await multiplayer.start();
    battle = new BattleController(multiplayer,{onView:renderBattle,onAura:renderAura,onMessage:error => notify(friendlyError(error))});
    await battle.start();
  } catch (error) {
    connectionReady = false; showJoinError(error);
    battle?.destroy(); battle = null; multiplayer?.destroy(); multiplayer = null;
  }
}
initializeMultiplayer();

function interact(person) {
  if (!player || person === player || !connectionReady) return;
  const record = multiplayer.players.get(person.id);
  if (!record) { notify('Ese jugador ya no está conectado.'); return; }
  if (!near(player,person) || !near(player,record)) { notify('Acércate para desafiar a este jugador.'); return; }
  if (battle?.locked || busyFight(battle?.arena,person.id)) { notify('Ya hay una invitación o batalla pendiente.'); return; }
  const cooldown = Math.max(battle?.arena.slots?.[player.id]?.cooldownUntil || 0,battle?.arena.slots?.[person.id]?.cooldownUntil || 0);
  if (cooldown > multiplayer.now()) { notify('Espera unos segundos antes de otra batalla.'); return; }
  interactionTarget = person.id;
  document.querySelector('#interaction-name').textContent = person.name;
  document.querySelector('#interaction-avatar').innerHTML = character(person.index);
  interactionDialog.showModal();
}
document.querySelector('#close-interaction').addEventListener('click', () => interactionDialog.close());
document.querySelector('#challenge-button').addEventListener('click', async () => {
  if (!interactionTarget || battleActionPending) return;
  // Recheck both visible and shared positions: the rival can move while this menu is open.
  const person = remotePlayers.get(interactionTarget), record = multiplayer?.players.get(interactionTarget);
  if (!player || !person || !record) { interactionDialog.close(); notify('Ese jugador ya no está conectado.'); return; }
  if (!near(player,person) || !near(player,record)) { interactionDialog.close(); notify('Acércate para desafiar a este jugador.'); return; }
  battleActionPending = true;
  document.querySelector('#challenge-button').disabled = true;
  try { await battle.invite(interactionTarget); interactionDialog.close(); }
  catch (error) { notify(friendlyError(error)); }
  finally { battleActionPending = false; document.querySelector('#challenge-button').disabled = false; }
});
async function battleAction(action) {
  if (!battle || battleActionPending) return;
  battleActionPending = true;
  try { await action(); }
  catch (error) { notify(friendlyError(error)); }
  finally { battleActionPending = false; battle.render(); }
}
document.querySelector('#accept-fight').addEventListener('click', () => battleAction(() => battle.respond(true)));
document.querySelector('#decline-fight').addEventListener('click', () => battleAction(() => battle.respond(false)));
document.querySelector('#cancel-fight').addEventListener('click', () => battleAction(() => battle.cancel('left')));
document.querySelector('#close-battle').addEventListener('click', () => battle.dismiss());
battleDialog.addEventListener('cancel', event => {
  event.preventDefault();
  if (!battle?.locked) battle?.dismiss();
  else if (battle.current.status === 'pending' && battle.current.to === player?.id) battleAction(() => battle.respond(false));
  else battleAction(() => battle.cancel('left'));
});
const powerButton = document.querySelector('#power-button');
powerButton.addEventListener('pointerdown', event => {
  if (event.button !== 0 || event.isPrimary === false) return;
  event.preventDefault(); battle?.tap();
});
powerButton.addEventListener('click', event => { if (event.detail === 0) battle?.tap(); });
powerButton.addEventListener('contextmenu', event => event.preventDefault());

function text(selector,value) {
  const element = document.querySelector(selector);
  if (element.textContent !== String(value)) element.textContent = value;
}
function renderAura(ids) {
  for (const person of [player,...neighbors].filter(Boolean)) person.element.classList.toggle('has-aura',connectionReady && ids.has(person.id));
}
function renderBattle(view) {
  const {phase,fight,actor,count,now,changed} = view;
  if (phase === 'idle' || !player || !fight) { if (battleDialog.open) battleDialog.close(); return; }
  if (changed && ['invitation','waiting','countdown'].includes(phase)) {
    // A movement already in progress must stop too, before the distance check at accept.
    cancelAnimationFrame(walkingFrame); player.element.classList.remove('walking');
    document.querySelector('#move-marker').hidden = true;
    multiplayer.position(player.x,player.y).catch(error => notify(friendlyError(error)));
  }
  if (!battleDialog.open) { dialog.close(); interactionDialog.close(); battleDialog.showModal(); }
  const opponentName = fight.from === actor ? fight.name2 : fight.name1;
  const descriptions = {
    invitation:[`${opponentName} quiere retarte`,'Acepta una Aura Battle de cinco segundos.'],
    waiting:['Reto enviado',`Esperando a ${opponentName}…`],
    countdown:['Prepárate','La batalla empieza al mismo tiempo para ambos.'],
    power:['Aura Battle',now-fight.startAt < 500 ? 'FIGHT!' : '¡Toca POWER lo más rápido que puedas!'],
    settling:['¡Tiempo!','Esperando los dos resultados finales…'],
    finished:[fight.winner === 'draw' ? '¡Empate!' : `${fight.winner === fight.from ? fight.name1 : fight.name2} gana!`,`${fight.scores?.[fight.from]?.count || 0} vs ${fight.scores?.[fight.to]?.count || 0}`],
    declined:['Fight declined','El otro jugador rechazó la invitación.'],
    expired:['Invitación vencida','No hubo respuesta. Puedes intentar más tarde.'],
    canceled:['Batalla cancelada',fight.reason === 'disconnected' ? 'Un jugador perdió la conexión.' : fight.reason === 'scores-timeout' ? 'No llegaron ambos resultados a tiempo.' : 'Un jugador salió de la batalla.'],
    offline:['Conexión interrumpida','POWER está pausado. Espera a recuperar la conexión.']
  };
  const [title,copy] = descriptions[phase] || ['Aura Battle',''];
  text('#battle-title',title); text('#battle-copy',copy);
  text('#battle-tag',['power','countdown'].includes(phase) ? 'EN JUEGO' : 'RETO');
  text('#battle-name-a',fight.name1); text('#battle-name-b',fight.name2);
  text('#battle-score-a',fight.from === actor && fight.status === 'active' ? count : fight.scores?.[fight.from]?.count || 0);
  text('#battle-score-b',fight.to === actor && fight.status === 'active' ? count : fight.scores?.[fight.to]?.count || 0);
  const portraits = [[document.querySelector('#battle-avatar-a'),fight.avatar1],[document.querySelector('#battle-avatar-b'),fight.avatar2]];
  for (const [element,avatar] of portraits) if (element.dataset.avatar !== String(avatar)) { element.dataset.avatar = String(avatar); element.innerHTML = character(avatar); }
  document.querySelector('#battle-countdown').hidden = phase !== 'countdown';
  if (phase === 'countdown') text('#battle-countdown',Math.min(3,Math.max(1,Math.ceil((fight.startAt-now)/1000))));
  document.querySelector('#battle-timer-wrap').hidden = !['power','settling'].includes(phase);
  const remaining = Math.max(0,fight.endAt-now);
  text('#battle-time',`${(remaining/1000).toFixed(1)} s`);
  document.querySelector('#battle-progress').value = remaining;
  powerButton.hidden = !['power','settling'].includes(phase);
  powerButton.disabled = phase !== 'power' || !connectionReady;
  text('#local-power',`Power: ${count}`);
  for (const [selector,show] of [['#accept-fight',phase==='invitation'],['#decline-fight',phase==='invitation'],['#cancel-fight',['waiting','countdown','power','settling','offline'].includes(phase)],['#close-battle',['finished','declined','expired','canceled'].includes(phase)]]) {
    const button = document.querySelector(selector); button.hidden = !show;
    button.disabled = battleActionPending || (!connectionReady && selector !== '#close-battle');
  }
  text('#cancel-fight',phase==='waiting' ? 'Cancelar invitación' : 'Abandonar');
  text('#battle-note',phase==='finished' ? 'Pausa de cinco segundos antes de la siguiente batalla.' : 'Un pulgar. Cinco segundos. Toda tu aura.');
  if (changed) announcement.textContent = `${title}. ${copy}`;
}
