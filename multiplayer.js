import { withTimeout } from './firebase.js';

export const REACTIONS = ['😂', '❤️', '🔥', '👏', '💀', '67', '👋'];
export const PRESENCE_LEASE = 45000;

export function createId(cryptoAPI = globalThis.crypto) {
  if (typeof cryptoAPI.randomUUID === 'function') return cryptoAPI.randomUUID();
  // randomUUID requires HTTPS. getRandomValues also works in LAN HTTP previews.
  const bytes = cryptoAPI.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes,byte => byte.toString(16).padStart(2,'0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

export function validPlayer(value) {
  return value && typeof value.name === 'string' && value.name.trim().length > 0 && value.name.length <= 18
    && Number.isInteger(value.avatar) && value.avatar >= 0 && value.avatar < 24
    && Number.isFinite(value.x) && value.x >= 125 && value.x <= 1315
    && Number.isFinite(value.y) && value.y >= 360 && value.y <= 845 && value.online === true
    && Number.isFinite(value.lastSeen);
}

// The renderer receives plain records; Firebase never controls DOM or animations.
export class Multiplayer {
  constructor({ sdk, db, path }, { onPlayers, onConnection, onError }) {
    Object.assign(this, { sdk, db, path, onPlayers, onConnection, onError });
    this.players = new Map(); this.rawPlayers = {}; this.self = null;
    this.connected = false; this.ready = false; this.offset = 0; this.unsubscribers = [];
    this.epoch = 0;
  }
  now() { return Date.now() + this.offset; }
  reference(suffix) { return this.sdk.ref(this.db, `${this.path}/${suffix}`); }
  async start() {
    const { sdk, db } = this;
    let resolvePlayers, resolveConnection;
    const firstPlayers = new Promise(resolve => { resolvePlayers = resolve; });
    const firstConnection = new Promise(resolve => { resolveConnection = resolve; });
    this.unsubscribers.push(
      sdk.onValue(sdk.ref(db, '.info/serverTimeOffset'), snapshot => { this.offset = Number(snapshot.val()) || 0; }),
      sdk.onValue(this.reference('players'), snapshot => {
        this.rawPlayers = snapshot.val() || {}; this.refreshPlayers(); resolvePlayers();
      }, error => this.onError(error)),
      sdk.onValue(sdk.ref(db, '.info/connected'), snapshot => {
        this.connected = snapshot.val() === true; this.ready = false;
        this.onConnection({ connected:this.connected, ready:false });
        if (this.connected) {
          resolveConnection();
          if (this.self) this.publishPresence().catch(error => this.onError(error));
          else { this.ready = true; this.onConnection({ connected:true, ready:true }); }
        }
      })
    );
    this.heartbeat = setInterval(() => {
      if (this.self && this.ready) this.writeSelf({ lastSeen:sdk.serverTimestamp() }).catch(error => this.onError(error));
      this.refreshPlayers();
    }, 10000);
    await withTimeout(Promise.all([firstPlayers, firstConnection]));
  }
  refreshPlayers() {
    const now = this.now();
    this.players = new Map(Object.entries(this.rawPlayers).filter(([, record]) => validPlayer(record) && now-record.lastSeen < PRESENCE_LEASE));
    this.onPlayers(this.players);
  }
  async publishPresence() {
    const self = this.self, epoch = ++this.epoch;
    if (!self || !this.connected) return;
    this.ready = false;
    const ref = this.reference(`players/${self.id}`);
    // Register server-side cleanup BEFORE publishing. Re-register after every reconnect.
    await withTimeout(this.sdk.onDisconnect(ref).remove());
    if (this.self !== self || epoch !== this.epoch || !this.connected) return;
    await withTimeout(this.sdk.set(ref, { ...self.data, reaction:null, lastSeen:this.sdk.serverTimestamp() }));
    if (this.self !== self || epoch !== this.epoch) {
      await this.sdk.remove(ref); return;
    }
    if (this.connected) {
      this.ready = true; this.onConnection({ connected:true, ready:true });
    }
  }
  async join(data) {
    if (!this.connected) throw new Error('Sin conexión con Firebase. Espera un momento y vuelve a intentar.');
    if (this.self) throw new Error('Ya estás en la sala.');
    const id = createId(); // Per join/tab, never a shared localStorage identity.
    this.self = { id, data:{ ...data, online:true } };
    try { await this.publishPresence(); return id; }
    catch (error) { await this.leave(); throw error; }
  }
  async leave() {
    const self = this.self; this.self = null; this.ready = false; this.epoch++;
    if (!self) return;
    const ref = this.reference(`players/${self.id}`);
    // If offline, cleanup remains armed on the server; the queued remove is safe.
    const cleanup = this.sdk.remove(ref).then(() => this.sdk.onDisconnect(ref).cancel());
    if (this.connected) await withTimeout(cleanup, 4000).catch(error => this.onError(error));
    else cleanup.catch(error => this.onError(error));
    this.ready = this.connected; this.onConnection({ connected:this.connected, ready:this.ready });
  }
  async writeSelf(patch) {
    if (!this.self || !this.ready || !this.connected) return false;
    Object.assign(this.self.data, patch);
    await this.sdk.update(this.reference(`players/${this.self.id}`), patch);
    return true;
  }
  async position(x, y) {
    return this.writeSelf({ x:Math.round(x), y:Math.round(y), lastSeen:this.sdk.serverTimestamp() });
  }
  async react(emoji) {
    if (!REACTIONS.includes(emoji)) return;
    return this.writeSelf({ reaction:{ id:createId(), emoji, at:this.sdk.serverTimestamp() } });
  }
  destroy() {
    clearInterval(this.heartbeat); this.unsubscribers.forEach(unsubscribe => unsubscribe());
    this.unsubscribers = [];
  }
}
