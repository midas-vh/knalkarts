import * as THREE from 'three';
import { Track } from './track.js';
import { Kart, makeKartMesh, makeLabel, KART_COLORS } from './kart.js';
import { Net } from './net.js';
import { Sfx } from './sfx.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrapA = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const now = () => performance.now() / 1000;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtTime = (t) => { const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`; };

const BOT_NAMES = ['Turbo Tijs', 'Snelle Sanne', 'Bliksem Bram', 'Raket Roos', 'Drifter Daan', 'Vlugge Vera', 'Knal Kees'];
const MAX_PLAYERS = 8;
const FILL_TO = 6;
const ITEM_ICON = { turbo: '🚀', olie: '🛢️', bal: '💥' };
const ITEM_KEYS = Object.keys(ITEM_ICON);
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
const INTERP_DELAY = 0.15;

// ---------- 3D-wereld ----------
const renderer = new THREE.WebGLRenderer({ canvas: $('c'), antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fd3ff);
scene.fog = new THREE.Fog(0x8fd3ff, 140, 460);
const camera = new THREE.PerspectiveCamera(70, 1, 0.5, 1000);
scene.add(new THREE.HemisphereLight(0xffffff, 0x6a8f3a, 1.15));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(80, 150, 40);
scene.add(sun);
let baseFov = 70;
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  baseFov = w < h ? 88 : 70;
  camera.fov = baseFov;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

const track = new Track(scene);

const boxGeo = new THREE.BoxGeometry(1.7, 1.7, 1.7);
const boxMat = new THREE.MeshNormalMaterial({ transparent: true, opacity: 0.85 });
const boxMeshes = track.boxSpots.map(([x, z]) => {
  const m = new THREE.Mesh(boxGeo, boxMat);
  m.position.set(x, 1.5, z);
  scene.add(m);
  return m;
});
const oilGeo = new THREE.CircleGeometry(2.2, 20).rotateX(-Math.PI / 2);
const oilMat = new THREE.MeshBasicMaterial({ color: 0x15121f, transparent: true, opacity: 0.88 });
const oilShine = new THREE.MeshBasicMaterial({ color: 0x6b4fd8, transparent: true, opacity: 0.5 });
const ballGeo = new THREE.SphereGeometry(0.8, 14, 10);
const ballMat = new THREE.MeshLambertMaterial({ color: 0xff3b30, emissive: 0x661100 });

// ---------- toestand ----------
const net = new Net();
const sfx = new Sfx();
let mode = 'menu';          // menu | lobby | countdown | race | results
let lobby = { players: [], laps: 3, fillBots: true, racing: false, code: '' };
let race = null;
let lastHostMsg = 0;
const lastSeen = new Map();
const me = { name: '', color: KART_COLORS[Math.floor(Math.random() * KART_COLORS.length)] };
try {
  const saved = JSON.parse(localStorage.getItem('knalkarts') || '{}');
  if (saved.name) me.name = saved.name;
  if (saved.color) me.color = saved.color;
} catch { /* */ }

// ---------- invoer ----------
const inp = { steer: 0, brake: false, drift: false, itemQueued: false };
const keys = {};
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  keys[e.code] = true;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (['KeyE', 'Enter', 'KeyX'].includes(e.code) && !e.repeat) inp.itemQueued = true;
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

function readInput() {
  let steer = inp.steer;
  const kl = keys.ArrowLeft || keys.KeyA, kr = keys.ArrowRight || keys.KeyD;
  if (kl || kr) steer = (kr ? 1 : 0) - (kl ? 1 : 0);
  const r = {
    steer, gas: true,
    brake: inp.brake || keys.ArrowDown || keys.KeyS,
    drift: inp.drift || keys.Space || keys.ShiftLeft,
    item: inp.itemQueued,
  };
  inp.itemQueued = false;
  return r;
}

{ // stuur-schuif
  const pad = $('steer'), knob = $('knob');
  let pid = null;
  const set = (e) => {
    const r = pad.getBoundingClientRect();
    const s = clamp((e.clientX - (r.left + r.width / 2)) / (r.width / 2) * 1.3, -1, 1);
    inp.steer = s;
    knob.style.transform = `translateX(${s * (r.width / 2 - 36)}px)`;
  };
  pad.addEventListener('pointerdown', (e) => {
    e.preventDefault(); pid = e.pointerId;
    try { pad.setPointerCapture(pid); } catch { /* */ }
    set(e);
  });
  pad.addEventListener('pointermove', (e) => { if (e.pointerId === pid) set(e); });
  const end = (e) => { if (e.pointerId === pid) { pid = null; inp.steer = 0; knob.style.transform = ''; } };
  pad.addEventListener('pointerup', end);
  pad.addEventListener('pointercancel', end);
}
function holdBtn(el, on, off) {
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try { el.setPointerCapture(e.pointerId); } catch { /* */ }
    el.classList.add('on'); on();
  });
  const end = () => { el.classList.remove('on'); off?.(); };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}
holdBtn($('bDrift'), () => { inp.drift = true; }, () => { inp.drift = false; });
holdBtn($('bBrake'), () => { inp.brake = true; }, () => { inp.brake = false; });
holdBtn($('bItem'), () => { inp.itemQueued = true; });
$('controls').addEventListener('contextmenu', (e) => e.preventDefault());

// ---------- menu ----------
function showScreen(name) {
  for (const s of ['menu', 'lobby', 'results']) $(s).classList.toggle('hidden', s !== name);
}
const setMsg = (id, t) => { $(id).textContent = t || ''; };

function renderColors() {
  $('colors').innerHTML = KART_COLORS.map((c) =>
    `<button class="sw${c === me.color ? ' sel' : ''}" style="background:${c}" data-c="${c}" aria-label="kleur"></button>`).join('');
}
$('colors').addEventListener('click', (e) => {
  const c = e.target.dataset?.c;
  if (c) { me.color = c; renderColors(); }
});
$('name').value = me.name;
renderColors();
const urlCode = new URLSearchParams(location.search).get('race');
if (urlCode) {
  $('code').value = urlCode.toUpperCase().slice(0, 4);
  setMsg('menuMsg', 'Je bent uitgenodigd! Vul je naam in en druk op Meedoen.');
}
if (isTouch) $('keysHint').classList.add('hidden');

function readMe() {
  me.name = $('name').value.trim().replace(/[<>&"]/g, '').slice(0, 12) || 'Racer ' + Math.floor(Math.random() * 90 + 10);
  $('name').value = me.name;
  try { localStorage.setItem('knalkarts', JSON.stringify({ name: me.name, color: me.color })); } catch { /* */ }
}
function prepDevice() {
  sfx.init();
  if (isTouch) {
    try { document.documentElement.requestFullscreen?.().catch(() => {}); } catch { /* */ }
    try { screen.orientation?.lock?.('landscape').catch(() => {}); } catch { /* */ }
  }
  try { navigator.wakeLock?.request('screen').catch(() => {}); } catch { /* */ }
}
function makeCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let s = '';
  for (let i = 0; i < 4; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
}

$('btnHost').onclick = async () => {
  readMe(); prepDevice();
  setMsg('menuMsg', 'Race maken…');
  for (let tries = 0; tries < 4; tries++) {
    const code = makeCode();
    try {
      await net.host(code);
      lobby = { players: [{ id: net.id, name: me.name, color: me.color }], laps: +$('laps').value, fillBots: $('fillBots').checked, racing: false, code };
      mode = 'lobby';
      showScreen('lobby');
      renderLobby();
      setMsg('menuMsg', '');
      return;
    } catch (e) {
      if (e.type !== 'unavailable-id') {
        setMsg('menuMsg', `Kon de race niet maken. Heb je internet? (${e.type || e.message})`);
        return;
      }
    }
  }
  setMsg('menuMsg', 'Probeer het nog eens.');
};

$('btnJoin').onclick = async () => {
  readMe();
  const code = $('code').value.trim().toUpperCase();
  if (code.length !== 4) { setMsg('menuMsg', 'Vul de code van 4 letters in.'); return; }
  prepDevice();
  setMsg('menuMsg', `Verbinden met ${code}…`);
  try {
    await net.join(code);
    lastHostMsg = now();
    lobby = { players: [], laps: 3, racing: false, code };
    net.send({ t: 'hello', name: me.name, color: me.color });
    mode = 'lobby';
    showScreen('lobby');
    renderLobby();
    setMsg('menuMsg', '');
  } catch (e) {
    net.close();
    setMsg('menuMsg', e.type === 'peer-unavailable'
      ? `Race ${code} niet gevonden. Klopt de code?`
      : `Verbinden mislukt (${e.type || e.message}).`);
  }
};
$('code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btnJoin').click(); });

$('btnSolo').onclick = () => {
  readMe(); prepDevice();
  net.startOffline();
  lobby = { players: [{ id: net.id, name: me.name, color: me.color }], laps: 3, fillBots: true, racing: false, code: '', solo: true };
  hostStart();
};

function renderLobby() {
  $('roomCode').textContent = lobby.code || '----';
  const host = lobby.players[0];
  $('players').innerHTML = lobby.players.map((p) =>
    `<li><span class="dot" style="background:${p.color}"></span>${esc(p.name)}${p.id === net.id ? ' (jij)' : ''}<span class="tag">${p === host ? '👑 host' : ''}</span></li>`).join('');
  $('hostOpts').classList.toggle('hidden', !net.isHost);
  $('laps').value = String(lobby.laps);
  let msg = '';
  if (!net.isHost) msg = lobby.racing ? 'Er is een race bezig. Je doet mee met de volgende!' : 'Wachten tot de host op START drukt…';
  else if (lobby.players.length === 1) msg = 'Stuur de code naar je vrienden. Je kunt ook meteen starten.';
  setMsg('lobbyMsg', msg);
}
function broadcastLobby() {
  net.broadcast({ t: 'lobby', players: lobby.players, laps: lobby.laps, racing: lobby.racing, code: lobby.code });
  if (mode === 'lobby') renderLobby();
}
$('laps').onchange = () => { lobby.laps = +$('laps').value; broadcastLobby(); };
$('fillBots').onchange = () => { lobby.fillBots = $('fillBots').checked; };
$('btnStart').onclick = () => hostStart();
$('btnLeave').onclick = () => leave();
$('btnMenu').onclick = () => leave();
$('btnAgain').onclick = () => { if (lobby.solo) hostStart(); else backToLobby(); };
$('btnShare').onclick = async () => {
  const url = `${location.origin}${location.pathname}?race=${lobby.code}`;
  const text = `Race mee met Knalkarts! Code: ${lobby.code}`;
  try {
    if (navigator.share) { await navigator.share({ title: 'Knalkarts', text, url }); return; }
    await navigator.clipboard.writeText(`${text} ${url}`);
    setMsg('lobbyMsg', 'Link gekopieerd! Plak hem in de groepsapp.');
  } catch { setMsg('lobbyMsg', url); }
};
$('mute').onclick = () => { sfx.setMuted(!sfx.muted); $('mute').textContent = sfx.muted ? '🔇' : '🔊'; };

function leave(msg) {
  net.close();
  clearRace();
  lastSeen.clear();
  mode = 'menu';
  showScreen('menu');
  setMsg('menuMsg', msg || '');
}

// ---------- netwerkberichten ----------
net.onMessage = (m, from) => {
  try { if (net.isHost) hostRecv(m, from); else clientRecv(m); } catch (e) { console.error(e); }
};
net.onPeerLeave = (id) => dropPlayer(id);
net.onHostLost = () => leave('De verbinding met de host is weg.');

function hostRecv(m, from) {
  lastSeen.set(from, now());
  switch (m.t) {
    case 'hello': {
      if (lobby.players.some((p) => p.id === from)) return;
      if (lobby.players.length >= MAX_PLAYERS) { net.sendTo(from, { t: 'full' }); return; }
      let color = KART_COLORS.includes(m.color) ? m.color : KART_COLORS[0];
      if (lobby.players.some((p) => p.color === color)) color = KART_COLORS.find((c) => !lobby.players.some((p) => p.color === c)) || color;
      lobby.players.push({ id: from, name: String(m.name || 'Racer').replace(/[<>&"]/g, '').slice(0, 12), color });
      broadcastLobby();
      break;
    }
    case 's':
      if (race) { const e = race.karts.get(from); if (e && !e.kart) receiveState(e, m.k); }
      break;
    case 'box': case 'haz': case 'rm':
      applyEvent(m);
      net.broadcast(m, from);
      break;
  }
}
function clientRecv(m) {
  lastHostMsg = now();
  switch (m.t) {
    case 'lobby':
      lobby = { ...lobby, players: m.players, laps: m.laps, racing: m.racing, code: m.code };
      if (race && !m.racing) clearRace();
      if (!race) { mode = 'lobby'; showScreen('lobby'); renderLobby(); }
      break;
    case 'start': startRace(m); break;
    case 'S':
      if (race) for (const a of m.k) {
        if (a[0] === net.id) continue;
        const e = race.karts.get(a[0]);
        if (e && !e.kart) receiveState(e, a);
      }
      break;
    case 'box': case 'haz': case 'rm': applyEvent(m); break;
    case 'end': showResults(m.res); break;
    case 'left': removeKart(m.id); break;
    case 'full': leave('Deze race zit vol (max 8 spelers).'); break;
  }
}
function dropPlayer(id) {
  lastSeen.delete(id);
  const had = lobby.players.some((p) => p.id === id);
  lobby.players = lobby.players.filter((p) => p.id !== id);
  removeKart(id);
  net.closeConn(id);
  if (had) {
    net.broadcast({ t: 'left', id });
    broadcastLobby();
  }
}
function removeKart(id) {
  if (!race) return;
  const e = race.karts.get(id);
  if (!e) return;
  scene.remove(e.mesh);
  race.karts.delete(id);
}

// hartslag: merk op als iemand wegvalt
setInterval(() => {
  if (!net.peer) return;
  const t = now();
  if (net.isHost) {
    if (!race) net.broadcast({ t: 'ping' });
    for (const p of [...lobby.players]) {
      if (p.id === net.id) continue;
      if (!lastSeen.has(p.id)) lastSeen.set(p.id, t);
      if (t - lastSeen.get(p.id) > 12) dropPlayer(p.id);
    }
  } else {
    if (!race) net.send({ t: 'ping' });
    if (t - lastHostMsg > 12) leave('De verbinding met de host is weg.');
  }
}, 1000);

// ---------- race ----------
function hostStart() {
  const grid = lobby.players.map((p) => ({ ...p, bot: false }));
  const humans = grid.slice().sort(() => Math.random() - 0.5);
  const bots = [];
  if (lobby.fillBots) {
    const used = new Set(grid.map((p) => p.color));
    const names = BOT_NAMES.slice().sort(() => Math.random() - 0.5);
    for (let n = 0; grid.length + bots.length < FILL_TO; n++) {
      const color = KART_COLORS.find((c) => !used.has(c)) || KART_COLORS[n % KART_COLORS.length];
      used.add(color);
      bots.push({ id: 'bot' + n, name: names[n % names.length], color, bot: true });
    }
  }
  const msg = { t: 'start', grid: [...bots, ...humans], laps: lobby.laps };
  lobby.racing = true;
  net.broadcast(msg);
  startRace(msg);
}

function startRace(msg) {
  clearRace();
  const t = now();
  race = {
    laps: msg.laps, karts: new Map(), hazards: new Map(), hz: 0,
    startAt: t + 3.6, t0: t + 3.6, me: null, ranks: new Map(), order: [],
    boxes: track.boxSpots.map(([x, z]) => ({ x, z, active: true, back: 0 })),
    lastLap: 0, ended: false, endAt: 0, firstFinAt: 0, lastCount: 4,
  };
  boxMeshes.forEach((m) => { m.visible = true; });
  msg.grid.forEach((p, slot) => {
    const mesh = makeKartMesh(p.color);
    scene.add(mesh);
    const row = Math.floor(slot / 2), side = slot % 2 ? -3.6 : 3.6;
    const i = (track.N - 8 - row * 7 + track.N) % track.N;
    const [x, z] = track.pos(i, side);
    const h = track.heading(i);
    const e = { id: p.id, name: p.name, color: p.color, bot: !!p.bot, mesh, buf: [], x, z, yaw: h, tot: -1, fin: false, ft: 0, dr: 0, b: 0, v: 0 };
    if (p.id === net.id || (p.bot && net.isHost)) {
      e.kart = new Kart(track);
      e.kart.place(x, z, h);
      e.kart.initProgress();
      e.kart.maxSpeed = p.bot ? 28 + Math.random() * 2.4 : 31;
      e.baseMax = e.kart.maxSpeed;
    }
    if (p.bot) e.ai = { seed: Math.random() * 100, useAt: 0 };
    if (p.id !== net.id) mesh.add(makeLabel(p.name, p.color));
    mesh.position.set(x, 0, z);
    mesh.rotation.y = h;
    race.karts.set(p.id, e);
  });
  race.me = race.karts.get(net.id) || null;
  inp.itemQueued = false;
  mode = 'countdown';
  showScreen(null);
  $('hud').classList.remove('hidden');
  $('controls').classList.toggle('hidden', !isTouch || !race.me);
  document.body.classList.add('racing');
  $('countdown').textContent = '';
  const f = race.me || race.karts.values().next().value;
  if (f) snapCamera(f.x, f.z, f.yaw);
}

function clearRace() {
  if (race) {
    for (const e of race.karts.values()) scene.remove(e.mesh);
    for (const h of race.hazards.values()) scene.remove(h.mesh);
  }
  race = null;
  boxMeshes.forEach((m) => { m.visible = true; });
  $('hud').classList.add('hidden');
  $('controls').classList.add('hidden');
  document.body.classList.remove('racing');
  sfx.engine(0, false);
}

function backToLobby() {
  clearRace();
  lobby.racing = false;
  mode = 'lobby';
  showScreen('lobby');
  broadcastLobby();
}

const isFin = (e) => (e.kart ? e.kart.fin : e.fin);
const totOf = (e) => (e.kart ? e.kart.tot : e.tot);
const ftOf = (e) => (e.kart ? e.kart.ft : e.ft);
const posOf = (e) => (e.kart ? [e.kart.x, e.kart.z] : [e.x, e.z]);

function standings() {
  return [...race.karts.values()].sort((a, b) => {
    const fa = isFin(a) ? 1 : 0, fb = isFin(b) ? 1 : 0;
    if (fa !== fb) return fb - fa;
    return fa ? ftOf(a) - ftOf(b) : totOf(b) - totOf(a);
  });
}

function endRace() {
  race.ended = true;
  const res = standings().map((e) => ({ id: e.id, name: e.name, color: e.color, bot: e.bot, fin: isFin(e), ft: ftOf(e) }));
  net.broadcast({ t: 'end', res });
  showResults(res);
}

function showResults(res) {
  if (!race) return;
  mode = 'results';
  $('controls').classList.add('hidden');
  $('resList').innerHTML = res.map((r, i) =>
    `<li class="${r.id === net.id ? 'me' : ''}"><span class="nr">${i + 1}</span><span class="dot" style="background:${r.color}"></span>${esc(r.name)}${r.bot ? ' 🤖' : ''}<span class="t">${r.fin ? fmtTime(r.ft) : 'niet gefinisht'}</span></li>`).join('');
  $('btnAgain').classList.toggle('hidden', !net.isHost);
  setMsg('resMsg', net.isHost ? '' : 'Wachten tot de host een nieuwe race start…');
  showScreen('results');
}

// ---------- items en gevaren ----------
function emit(m) {
  applyEvent(m);
  if (net.offline) return;
  if (net.isHost) net.broadcast(m); else net.send(m);
}
function applyEvent(m) {
  if (!race) return;
  if (m.t === 'box') {
    const b = race.boxes[m.i];
    if (b) { b.active = false; b.back = now() + 4; boxMeshes[m.i].visible = false; }
  } else if (m.t === 'haz') spawnHaz(m);
  else if (m.t === 'rm') removeHaz(m.id);
}
function spawnHaz(m) {
  if (race.hazards.has(m.id)) return;
  let mesh;
  if (m.kind === 'olie') {
    mesh = new THREE.Mesh(oilGeo, oilMat);
    const shine = new THREE.Mesh(oilGeo, oilShine);
    shine.scale.setScalar(0.45); shine.position.set(0.5, 0.01, 0.4);
    mesh.add(shine);
  } else mesh = new THREE.Mesh(ballGeo, ballMat);
  mesh.position.set(m.x, m.kind === 'olie' ? 0.1 : 0.8, m.z);
  scene.add(mesh);
  race.hazards.set(m.id, { ...m, born: now(), mesh, bi: track.nearest(m.x, m.z, -1).i });
}
function removeHaz(id) {
  const h = race?.hazards.get(id);
  if (!h) return;
  scene.remove(h.mesh);
  race.hazards.delete(id);
}
function rollItem(rank, total) {
  const r = total > 1 ? (rank - 1) / (total - 1) : 0.5;
  const w = r < 0.34 ? { olie: 5, bal: 3, turbo: 2 } : r < 0.67 ? { olie: 3, bal: 4, turbo: 3 } : { olie: 1, bal: 4, turbo: 5 };
  let x = Math.random() * 10;
  for (const k of ITEM_KEYS) { x -= w[k]; if (x <= 0) return k; }
  return 'turbo';
}
function useItem(e) {
  const k = e.kart, it = k.item;
  if (!it || it === '?') return;
  k.item = null;
  const fx = Math.sin(k.h), fz = Math.cos(k.h);
  if (it === 'turbo') { k.giveBoost(1.6); }
  else if (it === 'olie') emit({ t: 'haz', id: `${net.id.slice(-5)}-${++race.hz}`, kind: 'olie', x: k.x - fx * 3.2, z: k.z - fz * 3.2, o: e.id });
  else if (it === 'bal') emit({ t: 'haz', id: `${net.id.slice(-5)}-${++race.hz}`, kind: 'bal', x: k.x + fx * 3, z: k.z + fz * 3, h: k.h, o: e.id });
}
function tickItem(e, dt) {
  const k = e.kart;
  if (k.item !== '?') return;
  k.roll -= dt;
  if (k.roll <= 0) {
    k.item = rollItem(race.ranks.get(e.id) || 1, race.karts.size);
    if (e === race.me) sfx.beep(1046, 0.12, 'triangle');
  }
}
function checkBoxes(e) {
  const k = e.kart;
  race.boxes.forEach((b, i) => {
    if (!b.active) return;
    const dx = k.x - b.x, dz = k.z - b.z;
    if (dx * dx + dz * dz < 2.6 * 2.6) {
      emit({ t: 'box', i });
      if (!k.item) { k.item = '?'; k.roll = 0.9; }
      if (e === race.me) sfx.pickup();
    }
  });
}
function checkHazards(e) {
  const k = e.kart;
  if (k.invuln > 0 || k.spin > 0) return;
  for (const hz of race.hazards.values()) {
    const r = hz.kind === 'olie' ? 2.3 : 1.9;
    const dx = k.x - hz.x, dz = k.z - hz.z;
    if (dx * dx + dz * dz < r * r) {
      if (hz.kind === 'bal' && hz.o === e.id && now() - hz.born < 0.8) continue;
      if (!k.hit()) return;
      emit({ t: 'rm', id: hz.id });
      if (e === race.me) {
        sfx.hit();
        toast(hz.kind === 'olie' ? 'Uitgegleden!' : 'Geraakt!');
        try { navigator.vibrate?.(150); } catch { /* */ }
      }
      return;
    }
  }
}
function updateHazards(dt, t) {
  for (const hz of race.hazards.values()) {
    const age = t - hz.born;
    if (hz.kind === 'bal') {
      if (age > 6) { removeHaz(hz.id); continue; }
      hz.x += Math.sin(hz.h) * 46 * dt;
      hz.z += Math.cos(hz.h) * 46 * dt;
      const n = track.nearest(hz.x, hz.z, hz.bi);
      hz.bi = n.i;
      const lim = track.halfWidth + track.verge - 0.8;
      if (Math.abs(n.lat) > lim) {
        const s = Math.sign(n.lat), nx = track.nx[n.i] * s, nz = track.nz[n.i] * s;
        let dx = Math.sin(hz.h), dz = Math.cos(hz.h);
        const dot = dx * nx + dz * nz;
        if (dot > 0) { dx -= 2 * dot * nx; dz -= 2 * dot * nz; hz.h = Math.atan2(dx, dz); }
        hz.x -= nx * (Math.abs(n.lat) - lim);
        hz.z -= nz * (Math.abs(n.lat) - lim);
      }
      hz.mesh.position.set(hz.x, 0.8 + Math.abs(Math.sin(age * 9)) * 0.7, hz.z);
      hz.mesh.rotation.x += dt * 12;
    } else if (age > 30) removeHaz(hz.id);
  }
}

// ---------- bots ----------
function aiInput(k, ai, t) {
  const N = track.N;
  const j = (k.ti + Math.round(9 + Math.max(0, k.v) * 0.45)) % N;
  const off = Math.sin(t * 0.25 + ai.seed) * 4.5;
  const tx = track.px[j] + track.nx[j] * off, tz = track.pz[j] + track.nz[j] * off;
  const diff = wrapA(Math.atan2(tx - k.x, tz - k.z) - k.h);
  return { steer: clamp(-diff * 2.8, -1, 1), brake: false, drift: false, gas: !(Math.abs(diff) > 0.7 && k.v > 18) };
}
const autoPilot = { seed: 1.7, useAt: 0 };

// ---------- botsingen tussen karts ----------
function pushApart(e) {
  const k = e.kart;
  for (const o of race.karts.values()) {
    if (o === e) continue;
    const [ox, oz] = posOf(o);
    let dx = k.x - ox, dz = k.z - oz;
    const d2 = dx * dx + dz * dz;
    if (d2 < 2.4 * 2.4 && d2 > 1e-6) {
      const d = Math.sqrt(d2), push = (2.4 - d);
      dx /= d; dz /= d;
      if (o.kart) {
        k.x += dx * push / 2; k.z += dz * push / 2;
        o.kart.x -= dx * push / 2; o.kart.z -= dz * push / 2;
      } else { k.x += dx * push; k.z += dz * push; }
      k.v *= 0.985;
    }
  }
}

// ---------- netwerk-standen ----------
function stateOf(e) {
  const k = e.kart;
  return [e.id, +k.x.toFixed(2), +k.z.toFixed(2), +k.visYaw.toFixed(3), k.tot, k.fin ? 1 : 0, +k.ft.toFixed(2), k.driftLevel, k.boost > 0 ? 1 : 0, +k.v.toFixed(1), +k.y.toFixed(2)];
}
function receiveState(e, a) {
  e.buf.push({ t: now(), x: a[1], z: a[2], y: a[3], dr: a[7], b: a[8], v: a[9], hy: a[10] || 0 });
  if (e.buf.length > 30) e.buf.shift();
  e.tot = a[4]; e.fin = !!a[5]; e.ft = a[6];
  e.last = a;
}
function interp(e, rt) {
  const b = e.buf;
  if (!b.length) return;
  while (b.length > 2 && b[1].t <= rt) b.shift();
  const a = b[0], c = b[1];
  if (c && rt > a.t) {
    const f = clamp((rt - a.t) / (c.t - a.t), 0, 1);
    e.x = a.x + (c.x - a.x) * f;
    e.z = a.z + (c.z - a.z) * f;
    e.yaw = a.y + wrapA(c.y - a.y) * f;
    e.hy = a.hy + (c.hy - a.hy) * f;
    e.dr = c.dr; e.b = c.b; e.v = c.v;
  } else {
    e.x = a.x; e.z = a.z; e.yaw = a.y; e.dr = a.dr; e.b = a.b; e.v = a.v; e.hy = a.hy;
  }
}
let sendAcc = 0;
function sendStates() {
  if (net.offline || !race) return;
  if (net.isHost) {
    const list = [];
    for (const e of race.karts.values()) {
      if (e.kart) list.push(stateOf(e));
      else if (e.last) list.push(e.last);
    }
    net.broadcast({ t: 'S', k: list });
  } else if (race.me) net.send({ t: 's', k: stateOf(race.me) });
}

// ---------- beeld ----------
function updateKartVisual(e, dt, x, y, z, yaw, steer, dr, boost, v) {
  const m = e.mesh, u = m.userData;
  m.position.set(x, y, z);
  m.rotation.y = yaw;
  for (const w of u.wheels) w.rotation.x += v * dt / 0.42;
  for (const p of u.frontPivots) p.rotation.y = -steer * 0.45;
  for (const f of u.flames) { f.visible = !!boost; if (boost) f.scale.setScalar(0.8 + Math.random() * 0.6); }
  const sc = dr === 3 ? 0xff9f1c : dr === 2 ? 0x4cc9ff : 0xfff3b0;
  if (dr) u.sparkMat.color.setHex(sc);
  for (const s of u.sparks) { s.visible = dr > 0; if (dr) { s.scale.setScalar(0.6 + Math.random() * 0.9); s.rotation.y += dt * 20; } }
  u.shadow.position.y = 0.1 - y;
}

const camPos = new THREE.Vector3(), camTmp = new THREE.Vector3();
let camYaw = 0;
function snapCamera(x, z, yaw) {
  camYaw = yaw;
  camPos.set(x - Math.sin(yaw) * 8.5, 3.8, z - Math.cos(yaw) * 8.5);
  camera.position.copy(camPos);
  camera.lookAt(x, 1.2, z);
}
function followCamera(dt, x, z, heading, boosting) {
  camYaw += wrapA(heading - camYaw) * (1 - Math.exp(-dt * 5));
  camTmp.set(x - Math.sin(camYaw) * 8.5, 3.8, z - Math.cos(camYaw) * 8.5);
  camPos.lerp(camTmp, 1 - Math.exp(-dt * 12));
  camera.position.copy(camPos);
  camera.lookAt(x + Math.sin(camYaw) * 4, 1.3, z + Math.cos(camYaw) * 4);
  const fov = baseFov + (boosting ? 12 : 0);
  if (Math.abs(camera.fov - fov) > 0.1) {
    camera.fov += (fov - camera.fov) * Math.min(1, dt * 4);
    camera.updateProjectionMatrix();
  }
}

// minimap
const mm = $('minimap'), mctx = mm.getContext('2d');
const mmBg = document.createElement('canvas');
mmBg.width = mm.width; mmBg.height = mm.height;
const { minX, maxX, minZ, maxZ } = track.bounds;
const mmS = Math.min((mm.width - 20) / (maxX - minX), (mm.height - 20) / (maxZ - minZ));
const mmOX = (mm.width - (maxX - minX) * mmS) / 2, mmOY = (mm.height - (maxZ - minZ) * mmS) / 2;
const mmXY = (x, z) => [mmOX + (maxX - x) * mmS, mmOY + (maxZ - z) * mmS];
{
  const c = mmBg.getContext('2d');
  c.lineJoin = 'round';
  const path = () => {
    c.beginPath();
    for (let i = 0; i <= track.N; i += 4) { const [x, y] = mmXY(track.px[i % track.N], track.pz[i % track.N]); i ? c.lineTo(x, y) : c.moveTo(x, y); }
    c.closePath();
  };
  path(); c.strokeStyle = 'rgba(0,0,0,0.55)'; c.lineWidth = 11; c.stroke();
  path(); c.strokeStyle = 'rgba(255,255,255,0.9)'; c.lineWidth = 6; c.stroke();
  const [sx, sy] = mmXY(track.px[0], track.pz[0]);
  c.fillStyle = '#ff5a1f'; c.fillRect(sx - 3, sy - 3, 6, 6);
}
function drawMinimap() {
  mctx.clearRect(0, 0, mm.width, mm.height);
  mctx.drawImage(mmBg, 0, 0);
  for (const e of race.karts.values()) {
    if (e === race.me) continue;
    const [x, y] = mmXY(...posOf(e));
    mctx.fillStyle = e.color; mctx.beginPath(); mctx.arc(x, y, 4.5, 0, 7); mctx.fill();
  }
  if (race.me) {
    const [x, y] = mmXY(race.me.kart.x, race.me.kart.z);
    mctx.fillStyle = race.me.color; mctx.strokeStyle = '#fff'; mctx.lineWidth = 2.5;
    mctx.beginPath(); mctx.arc(x, y, 6.5, 0, 7); mctx.fill(); mctx.stroke();
  }
}

const hudCache = {};
function setHTML(id, html) { if (hudCache[id] !== html) { hudCache[id] = html; $(id).innerHTML = html; } }
let toastTimer = 0;
function toast(text, dur = 1.6) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), dur * 1000);
}
function popCount(text) {
  const el = $('countdown');
  el.textContent = text;
  el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
}

// ---------- spel-loop ----------
const IDLE = { steer: 0, brake: false, drift: false, gas: false };
let lastT = now(), hudAcc = 0;

function updateRace(dt, t) {
  // aftellen
  if (mode === 'countdown') {
    const left = race.startAt - t;
    const n = Math.ceil(left);
    if (n < race.lastCount && n >= 1 && n <= 3) { race.lastCount = n; popCount(String(n)); sfx.beep(440, 0.18); }
    if (left <= 0) {
      mode = 'race';
      race.t0 = race.startAt;
      popCount('START!');
      sfx.beep(880, 0.4);
      setTimeout(() => { if ($('countdown').textContent === 'START!') $('countdown').textContent = ''; }, 900);
    }
  }
  const go = mode !== 'countdown';

  // standen
  race.order = standings();
  race.order.forEach((e, i) => race.ranks.set(e.id, i + 1));

  // eigen kart
  const mine = race.me;
  if (mine) {
    const k = mine.kart;
    const ii = !go ? IDLE : k.fin ? aiInput(k, autoPilot, t) : readInput();
    k.update(dt, ii);
    if (go) {
      if (!k.fin && k.tot >= race.laps * track.N) {
        k.fin = true; k.ft = t - race.t0;
        $('controls').classList.add('hidden');
        toast(`FINISH! ${race.ranks.get(mine.id)}e plek`, 3);
        sfx.fanfare();
      }
      if (ii.item && !k.fin) useItem(mine);
      pushApart(mine); checkBoxes(mine); checkHazards(mine); tickItem(mine, dt);
      if (k.fin && k.item && k.item !== '?') useItem(mine);
    }
    if (k.boostFx) { k.boostFx = false; sfx.boost(); }
    if (k.bump) sfx.bump();
    // ronde-meldingen
    const lap = clamp(Math.floor(k.tot / track.N) + 1, 1, race.laps);
    if (lap > race.lastLap) {
      if (race.lastLap && lap === race.laps) toast('Laatste ronde!');
      else if (race.lastLap) toast(`Ronde ${lap}`);
      race.lastLap = lap;
    }
  }

  // bots (alleen bij de host)
  if (net.isHost) {
    let bestHuman = -1e9;
    for (const e of race.karts.values()) if (!e.bot) bestHuman = Math.max(bestHuman, totOf(e));
    for (const e of race.karts.values()) {
      if (!e.bot || !e.kart) continue;
      const k = e.kart;
      const gap = k.tot - bestHuman;
      k.maxSpeed = e.baseMax * (gap > track.N * 0.12 ? 0.9 : gap < -track.N * 0.2 ? 1.07 : 1);
      k.update(dt, go ? aiInput(k, e.ai, t) : IDLE);
      if (!go) continue;
      if (!k.fin && k.tot >= race.laps * track.N) { k.fin = true; k.ft = t - race.t0; }
      pushApart(e); checkBoxes(e); checkHazards(e); tickItem(e, dt);
      if (k.item && k.item !== '?') {
        if (!e.ai.useAt) e.ai.useAt = t + 1 + Math.random() * 3;
        if (t >= e.ai.useAt) { e.ai.useAt = 0; useItem(e); }
      }
    }
  }

  // anderen: soepel tussen ontvangen posities in
  const rt = t - INTERP_DELAY;
  for (const e of race.karts.values()) {
    if (e.kart) {
      const k = e.kart;
      e.x = k.x; e.z = k.z;
      updateKartVisual(e, dt, k.x, k.y, k.z, k.visYaw, k.steerVis, k.driftLevel, k.boost > 0, k.v);
    } else {
      interp(e, rt);
      updateKartVisual(e, dt, e.x, e.hy || 0, e.z, e.yaw, 0, e.dr, e.b, e.v);
    }
  }

  updateHazards(dt, t);
  race.boxes.forEach((b, i) => {
    if (!b.active && t >= b.back) { b.active = true; boxMeshes[i].visible = true; }
  });
  for (const m of boxMeshes) { m.rotation.y += dt * 1.5; m.rotation.x += dt * 0.7; m.position.y = 1.5 + Math.sin(t * 2 + m.position.x) * 0.25; }
  track.padTex.offset.y -= dt * 1.5;

  sendAcc += dt;
  if (sendAcc >= 1 / 15) { sendAcc = 0; sendStates(); }

  // einde van de race (host beslist)
  if (net.isHost && mode === 'race' && !race.ended) {
    const humans = [...race.karts.values()].filter((e) => !e.bot);
    const finN = humans.filter(isFin).length;
    if (finN && !race.firstFinAt) race.firstFinAt = t;
    if (!race.endAt && (finN === humans.length || (race.firstFinAt && t - race.firstFinAt > 30))) race.endAt = t + 3;
    if (race.endAt && t >= race.endAt) endRace();
  }

  // camera
  const focus = mine || race.order[0];
  if (focus) {
    if (focus.kart) followCamera(dt, focus.kart.x, focus.kart.z, focus.kart.h, focus.kart.boost > 0);
    else followCamera(dt, focus.x, focus.z, focus.yaw, focus.b);
  }
  if (mine) sfx.engine(Math.abs(mine.kart.v) / 45, mode !== 'results');

  // HUD
  hudAcc += dt;
  if (hudAcc > 0.08 && mine) {
    hudAcc = 0;
    const k = mine.kart;
    const rank = race.ranks.get(mine.id);
    setHTML('pos', `${rank}<sup>e</sup>`);
    setHTML('lap', `Ronde ${clamp(Math.floor(k.tot / track.N) + 1, 1, race.laps)}/${race.laps}`);
    const rtime = k.fin ? k.ft : Math.max(0, t - race.t0);
    setHTML('time', fmtTime(rtime));
    const icon = k.item === '?' ? ITEM_ICON[ITEM_KEYS[Math.floor(t * 12) % ITEM_KEYS.length]] : k.item ? ITEM_ICON[k.item] : '';
    setHTML('item', icon);
    setHTML('bItem', k.item && k.item !== '?' ? ITEM_ICON[k.item] : 'ITEM');
    $('bItem').classList.toggle('has', !!k.item && k.item !== '?');
    drawMinimap();
  }
}

function menuCamera(t) {
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  const r = Math.max(maxX - minX, maxZ - minZ) * 0.75;
  camera.position.set(cx + Math.cos(t * 0.05) * r, 110, cz + Math.sin(t * 0.05) * r);
  camera.lookAt(cx, 0, cz);
  for (const m of boxMeshes) { m.rotation.y += 0.02; }
  track.padTex.offset.y -= 0.02;
}

function loop() {
  requestAnimationFrame(loop);
  const t = now();
  const dt = Math.min(0.05, t - lastT);
  lastT = t;
  if (race) updateRace(dt, t);
  else menuCamera(t);
  renderer.render(scene, camera);
}
loop();

// handig voor testen in de console
window.knal = { get race() { return race; }, net, track, lobby: () => lobby };
