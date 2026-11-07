import * as THREE from 'three';
import { Track } from './track.js';
import { Kart, makeKartMesh, makeLabel, makeTakeltje, KART_COLORS, CLASSES, DEFAULT_CC } from './kart.js';
import { Net } from './net.js';
import { Sfx } from './sfx.js';
import { ITEMS, ITEM_KEYS, rollItem, itemIcon, makeBanana, makeGreenBall, makeHomingRocket, makeBomb,
  Explosion, makeComet, makeShield } from './items.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrapA = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
// speltijd: staat stil tijdens een pauze (alleen bij oefenen tegen de computer)
let pausedTotal = 0, pausedAt = 0, paused = false, pauseOpen = false;
const now = () => performance.now() / 1000 - pausedTotal;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtTime = (t) => { const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`; };

const BOT_NAMES = ['Turbo Tijs', 'Snelle Sanne', 'Bliksem Bram', 'Raket Roos', 'Drifter Daan', 'Vlugge Vera', 'Knal Kees'];
const MAX_PLAYERS = 8;
const FILL_TO = 6;
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
const INTERP_DELAY = 0.15;

// ---------- 3D-wereld ----------
const renderer = new THREE.WebGLRenderer({ canvas: $('c'), antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d1236);
scene.fog = new THREE.Fog(0x0d1236, 260, 1300);
const camera = new THREE.PerspectiveCamera(70, 1, 0.5, 2600);
scene.add(new THREE.HemisphereLight(0xc9d2ff, 0x2a2350, 1.25));
const sun = new THREE.DirectionalLight(0xd8deff, 1.3);
sun.position.set(-120, 200, 80);
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

const track = await Track.load(scene);

const boxGeo = new THREE.BoxGeometry(1.7, 1.7, 1.7);
const boxMat = new THREE.MeshNormalMaterial({ transparent: true, opacity: 0.85 });
const boxMeshes = track.boxSpots.map(([x, z, y]) => {
  const m = new THREE.Mesh(boxGeo, boxMat);
  m.position.set(x, y + 1.5, z);
  m.userData.by = y + 1.5;
  scene.add(m);
  return m;
});

// ---------- toestand ----------
const net = new Net();
const sfx = new Sfx();
let mode = 'menu';          // menu | lobby | countdown | race | results
let lobby = { players: [], laps: 3, cc: DEFAULT_CC, fillBots: true, racing: false, code: '' };
let race = null;
let lastHostMsg = 0;
const lastSeen = new Map();
const me = { name: '', color: KART_COLORS[Math.floor(Math.random() * KART_COLORS.length)], cc: DEFAULT_CC };
try {
  const saved = JSON.parse(localStorage.getItem('knalkarts') || '{}');
  if (saved.name) me.name = saved.name;
  if (saved.color) me.color = saved.color;
  if (CLASSES[saved.cc]) me.cc = saved.cc;
} catch { /* */ }

// ---------- invoer ----------
const inp = { steer: 0, brake: false, drift: false, itemQueued: false };
const keys = {};
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'Escape') { e.preventDefault(); if (pauseOpen) closePause(); else openPause(); return; }
  if (pauseOpen) return;
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
// snelheidsklasse (voor oefenen en als je host bent)
function renderCC() {
  for (const b of $('ccSel').children) b.classList.toggle('sel', +b.dataset.cc === me.cc);
}
$('ccSel').addEventListener('click', (e) => {
  const cc = +e.target.dataset?.cc;
  if (!CLASSES[cc]) return;
  me.cc = cc; renderCC();
  try {
    const saved = JSON.parse(localStorage.getItem('knalkarts') || '{}');
    localStorage.setItem('knalkarts', JSON.stringify({ ...saved, cc }));
  } catch { /* */ }
});
renderCC();
const urlCode = new URLSearchParams(location.search).get('race');
if (urlCode) {
  $('code').value = urlCode.toUpperCase().slice(0, 4);
  setMsg('menuMsg', 'Je bent uitgenodigd! Vul je naam in en druk op Meedoen.');
}
if (isTouch) $('keysHint').classList.add('hidden');

function readMe() {
  me.name = $('name').value.trim().replace(/[<>&"]/g, '').slice(0, 12) || 'Racer ' + Math.floor(Math.random() * 90 + 10);
  $('name').value = me.name;
  try { localStorage.setItem('knalkarts', JSON.stringify({ name: me.name, color: me.color, cc: me.cc })); } catch { /* */ }
}
// ---------- volledig scherm ----------
// Android: het spel kan zelf fullscreen gaan. iPhone: alleen als web-app vanaf het beginscherm.
const isIPhone = /iPhone|iPod/.test(navigator.userAgent);
const isStandalone = () => matchMedia('(display-mode: fullscreen)').matches
  || matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement;
function goFullscreen() {
  const el = document.documentElement, req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (!req || isStandalone() || fsElement()) return Promise.resolve(!!(isStandalone() || fsElement()));
  try {
    return Promise.resolve(req.call(el, { navigationUI: 'hide' }))
      .then(() => { try { screen.orientation?.lock?.('landscape').catch(() => {}); } catch { /* */ } return true; })
      .catch(() => false);
  } catch { return Promise.resolve(false); }
}
function updateFullBtn() { $('btnFull').classList.toggle('hidden', !isTouch || isStandalone() || !!fsElement()); }
function showInstall() {
  $('installIos').classList.toggle('hidden', !isIPhone);
  $('installAndroid').classList.toggle('hidden', isIPhone);
  $('install').classList.remove('hidden');
}
$('btnFull').onclick = () => {
  if (isIPhone) { showInstall(); return; }
  goFullscreen();
  // niet echt op volledig scherm gekomen? dan uitleggen hoe het via het startscherm kan
  setTimeout(() => { if (!fsElement() && !isStandalone()) showInstall(); }, 700);
};
$('btnInstallOk').onclick = () => $('install').classList.add('hidden');
document.addEventListener('fullscreenchange', updateFullBtn);
document.addEventListener('webkitfullscreenchange', updateFullBtn);
updateFullBtn();

function prepDevice() {
  sfx.init();
  if (isTouch) goFullscreen();
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
      lobby = { players: [{ id: net.id, name: me.name, color: me.color }], laps: +$('laps').value, cc: me.cc, fillBots: $('fillBots').checked, racing: false, code };
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
    lobby = { players: [], laps: 3, cc: DEFAULT_CC, racing: false, code };
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
  lobby = { players: [{ id: net.id, name: me.name, color: me.color }], laps: 3, cc: me.cc, fillBots: true, racing: false, code: '', solo: true };
  hostStart();
};

function renderLobby() {
  $('roomCode').textContent = lobby.code || '----';
  const host = lobby.players[0];
  $('players').innerHTML = lobby.players.map((p) =>
    `<li><span class="dot" style="background:${p.color}"></span>${esc(p.name)}${p.id === net.id ? ' (jij)' : ''}<span class="tag">${p === host ? '👑 host' : ''}</span></li>`).join('');
  $('hostOpts').classList.toggle('hidden', !net.isHost);
  $('laps').value = String(lobby.laps);
  $('cc').value = String(lobby.cc);
  $('raceInfo').textContent = `${lobby.cc}cc · ${lobby.laps} ${lobby.laps === 1 ? 'ronde' : 'rondes'}`;
  let msg = '';
  if (!net.isHost) msg = lobby.racing ? 'Er is een race bezig. Je doet mee met de volgende!' : 'Wachten tot de host op START drukt…';
  else if (lobby.players.length === 1) msg = 'Stuur de code naar je vrienden. Je kunt ook meteen starten.';
  setMsg('lobbyMsg', msg);
}
function broadcastLobby() {
  net.broadcast({ t: 'lobby', players: lobby.players, laps: lobby.laps, cc: lobby.cc, racing: lobby.racing, code: lobby.code });
  if (mode === 'lobby') renderLobby();
}
$('laps').onchange = () => { lobby.laps = +$('laps').value; broadcastLobby(); };
$('cc').onchange = () => { lobby.cc = +$('cc').value; me.cc = lobby.cc; renderCC(); broadcastLobby(); };
$('fillBots').onchange = () => { lobby.fillBots = $('fillBots').checked; };
$('btnStart').onclick = () => hostStart();
$('btnLeave').onclick = () => leave();
$('btnMenu').onclick = () => leave();
$('btnAgain').onclick = () => { if (lobby.solo) hostStart(); else backToLobby(); };
$('btnShare').onclick = async () => {
  const url = `${location.origin}${location.pathname}?race=${lobby.code}`;
  const text = `Race mee met RacePlanet! Code: ${lobby.code}`;
  try {
    if (navigator.share) { await navigator.share({ title: 'RacePlanet', text, url }); return; }
    await navigator.clipboard.writeText(`${text} ${url}`);
    setMsg('lobbyMsg', 'Link gekopieerd! Plak hem in de groepsapp.');
  } catch { setMsg('lobbyMsg', url); }
};
$('mute').onclick = () => { sfx.setMuted(!sfx.muted); $('mute').textContent = sfx.muted ? '🔇' : '🔊'; };

// ---------- pauze ----------
function openPause() {
  if (!race || pauseOpen || (mode !== 'race' && mode !== 'countdown')) return;
  pauseOpen = true;
  if (net.offline) { paused = true; pausedAt = performance.now() / 1000; }
  sfx.engine(0, false);
  setMsg('pauseMsg', net.offline ? ''
    : net.isHost ? 'Online gaat de race gewoon door; je kart staat stil zolang dit menu open is. Stop je, dan stopt de race voor iedereen.'
      : 'Online gaat de race gewoon door; je kart staat stil zolang dit menu open is.');
  for (const k in keys) keys[k] = false;
  inp.steer = 0; inp.drift = false; inp.brake = false;
  $('pause').classList.remove('hidden');
}
function closePause() {
  if (!pauseOpen) return;
  pauseOpen = false;
  if (paused) { pausedTotal += performance.now() / 1000 - pausedAt; paused = false; }
  $('pause').classList.add('hidden');
}
$('btnPause').onclick = () => openPause();
$('btnResume').onclick = () => closePause();
$('btnQuit').onclick = () => { closePause(); leave(); };
if (isTouch) $('pauseHint').classList.add('hidden');

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
      lobby = { ...lobby, players: m.players, laps: m.laps, cc: m.cc || DEFAULT_CC, racing: m.racing, code: m.code };
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
  if (e.tak) scene.remove(e.tak);
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
  const msg = { t: 'start', grid: [...bots, ...humans], laps: lobby.laps, cc: lobby.cc };
  lobby.racing = true;
  net.broadcast(msg);
  startRace(msg);
}

function startRace(msg) {
  clearRace();
  const t = now();
  const cls = CLASSES[msg.cc] || CLASSES[DEFAULT_CC];
  race = {
    laps: msg.laps, karts: new Map(), hazards: new Map(), hz: 0,
    startAt: t + 3.6, t0: t + 3.6, me: null, ranks: new Map(), order: [],
    boxes: track.boxSpots.map(([x, z, y]) => ({ x, z, y, active: true, back: 0 })),
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
      e.kart = new Kart(track, cls);
      e.kart.place(x, z, h);
      e.kart.initProgress();
      e.kart.maxSpeed = p.bot ? cls.bot + Math.random() * cls.botSpread : cls.player;
      e.baseMax = e.kart.maxSpeed;
    }
    if (p.bot) e.ai = { seed: Math.random() * 100, useAt: 0 };
    if (p.id !== net.id) mesh.add(makeLabel(p.name, p.color));
    e.hy = track.surfaceY(track.nearest(x, z, -1));
    mesh.position.set(x, e.hy, z);
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
  if (f) snapCamera(f.x, f.hy, f.z, f.yaw);
}

function clearRace() {
  if (race) {
    for (const e of race.karts.values()) { scene.remove(e.mesh); if (e.tak) scene.remove(e.tak); }
    for (const h of race.hazards.values()) scene.remove(h.mesh);
  }
  race = null;
  closePause();
  clearSparks();
  clearExplosions();
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
const yOf = (e) => (e.kart ? e.kart.py : e.hy || 0);
const rescuing = (e) => (e.kart ? e.kart.resc > 0 : e.rs > 0);

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
  closePause();
  mode = 'results';
  $('controls').classList.add('hidden');
  $('resList').innerHTML = res.map((r, i) =>
    `<li class="${r.id === net.id ? 'me' : ''}"><span class="nr">${i + 1}</span><span class="dot" style="background:${r.color}"></span>${esc(r.name)}${r.bot ? ' 🤖' : ''}<span class="t">${r.fin ? fmtTime(r.ft) : 'niet gefinisht'}</span></li>`).join('');
  $('btnAgain').classList.toggle('hidden', !net.isHost);
  setMsg('resMsg', net.isHost ? '' : 'Wachten tot de host een nieuwe race start…');
  showScreen('results');
}

// ---------- items en gevaren ----------
// banaan ligt stil, groen stuitert rechtdoor, rood zoekt de kart vóór je, bom ontploft na een lontje
const BOX_BACK = 1;          // itemkubus is na 1 seconde terug
const HAZ_R = { banaan: 1.7, groen: 1.9, rood: 2.0 };
const BOM_FUSE = 1.3, BOM_R = 8;
function emit(m) {
  applyEvent(m);
  if (net.offline) return;
  if (net.isHost) net.broadcast(m); else net.send(m);
}
function applyEvent(m) {
  if (!race) return;
  if (m.t === 'box') {
    const b = race.boxes[m.i];
    if (b) { b.active = false; b.back = now() + BOX_BACK; boxMeshes[m.i].visible = false; }
  } else if (m.t === 'haz') spawnHaz(m);
  else if (m.t === 'rm') removeHaz(m.id, true);
}
const upY = new THREE.Vector3(0, 1, 0), tmpUp = new THREE.Vector3();
const hazMakers = { banaan: makeBanana, groen: makeGreenBall, rood: makeHomingRocket, bom: makeBomb };
function spawnHaz(m) {
  if (race.hazards.has(m.id) || !hazMakers[m.kind]) return;
  const n = track.nearest(m.x, m.z, -1, m.y);
  const onRoad = track.onRoad(n);
  if (!onRoad && m.kind !== 'rood' && m.kind !== 'bom') return; // naast de baan: valt gewoon naar beneden
  const gy = onRoad ? track.surfaceY(n) : m.y;
  const mesh = hazMakers[m.kind]();
  mesh.position.set(m.x, gy, m.z);
  if (m.kind === 'banaan') {
    mesh.quaternion.setFromUnitVectors(upY, tmpUp.set(track.ux[n.i], track.uy[n.i], track.uz[n.i]));
    mesh.rotateY(Math.random() * 6);
  }
  scene.add(mesh);
  const hz = { ...m, y: gy, born: now(), mesh, bi: n.i };
  if (m.kind === 'rood') { hz.mi = n.i + clamp(n.along, -0.5, 0.5); hz.ml = n.lat; }
  if (m.kind === 'bom') { hz.y = m.y + 1; hz.vy = 7; hz.landed = false; }
  race.hazards.set(m.id, hz);
}
// boom = de zoekraket raakt iets: dan ontploft hij
function removeHaz(id, boom = false) {
  const h = race?.hazards.get(id);
  if (!h) return;
  scene.remove(h.mesh);
  race.hazards.delete(id);
  if (boom && h.kind === 'rood') spawnExplosion(h.x, h.y + 0.9, h.z, 3.2);
}

// ---------- explosies ----------
const explosions = [];
let camShake = 0;
function spawnExplosion(x, y, z, size) {
  const ex = new Explosion(size);
  ex.group.position.set(x, y, z);
  scene.add(ex.group);
  explosions.push(ex);
  // geluid en camera-schok, sterker als het dichtbij is
  const f = race?.me?.kart;
  const d = f ? Math.hypot(f.x - x, f.z - z, f.py - y) : 999;
  const near = clamp(1 - d / (size * 8), 0, 1);
  sfx.noise(0.6 + size * 0.04, 0.2 + near * 0.35, 260);
  sfx.beep(140, 0.45, 'sawtooth', 0.04 + near * 0.08, -90);
  camShake = Math.max(camShake, near * (size / 6));
}
function updateExplosions(dt) {
  for (let i = explosions.length - 1; i >= 0; i--) {
    if (!explosions[i].update(dt)) { scene.remove(explosions[i].group); explosions.splice(i, 1); }
  }
  camShake = Math.max(0, camShake - dt * 2);
}
function clearExplosions() {
  for (const ex of explosions) scene.remove(ex.group);
  explosions.length = 0; camShake = 0;
}
const hazId = () => `${net.id.slice(-5)}-${++race.hz}`;
function useItem(e) {
  const k = e.kart, it = k.item;
  if (!it || it === '?') return;
  const fx = Math.sin(k.h), fz = Math.cos(k.h);
  const y = +k.py.toFixed(2);
  if (it === 'komeet') { if (!k.startKomeet()) return; if (e === race.me) toast('KOMEET!'); }
  else if (it === 'turbo') k.giveBoost(1.6);
  else if (it === 'turbo3') k.giveBoost(1.3);
  else if (it === 'schild') k.shield = 10;
  else if (it === 'banaan') emit({ t: 'haz', id: hazId(), kind: 'banaan', x: k.x - fx * 3.4, z: k.z - fz * 3.4, y, o: e.id });
  else if (it === 'groen') emit({ t: 'haz', id: hazId(), kind: 'groen', x: k.x + fx * 3, z: k.z + fz * 3, y, h: k.h, o: e.id });
  else if (it === 'bom') emit({ t: 'haz', id: hazId(), kind: 'bom', x: k.x + fx * 3, z: k.z + fz * 3, y, h: k.h, sp: Math.max(0, k.v) + 18, o: e.id });
  else if (it === 'rood') {
    // zoekt de kart die direct vóór je staat
    const idx = race.order.indexOf(e);
    const target = idx > 0 ? race.order[idx - 1].id : null;
    emit({ t: 'haz', id: hazId(), kind: 'rood', x: k.x + fx * 3, z: k.z + fz * 3, y, h: k.h, o: e.id, tg: target });
  }
  // drie turbo's: item blijft tot ze op zijn
  if (it === 'turbo3' && --k.uses > 0) return;
  k.item = null; k.uses = 0;
}
function tickItem(e, dt) {
  const k = e.kart;
  if (k.item !== '?') return;
  k.roll -= dt;
  if (k.roll <= 0) {
    k.item = rollItem(race.ranks.get(e.id) || 1, race.karts.size);
    k.uses = ITEMS[k.item].uses || 0;
    if (e === race.me) { sfx.beep(1046, 0.12, 'triangle'); toast(ITEMS[k.item].naam, 1.1); }
  }
}
function checkBoxes(e) {
  const k = e.kart;
  race.boxes.forEach((b, i) => {
    if (!b.active) return;
    const dx = k.x - b.x, dz = k.z - b.z;
    if (dx * dx + dz * dz < 2.6 * 2.6 && Math.abs(k.py - b.y) < 3.5 && k.resc <= 0) {
      emit({ t: 'box', i });
      if (!k.item) { k.item = '?'; k.roll = 0.9; }
      if (e === race.me) sfx.pickup();
    }
  });
}
function hitFeedback(e, res, text) {
  if (e !== race.me || !res) return;
  if (res === 'schild') { toast('Schild!'); sfx.bump(); return; }
  sfx.hit(); toast(text);
  try { navigator.vibrate?.(150); } catch { /* */ }
}
const KOMEET_R = 3.2;
function checkHazards(e) {
  const k = e.kart;
  // een komeet ruimt gevaren op zijn pad op
  if (k.komeet > 0) {
    for (const hz of race.hazards.values()) {
      if (hz.kind === 'bom' || hz.o === e.id) continue;
      const dx = k.x - hz.x, dz = k.z - hz.z;
      if (dx * dx + dz * dz < 9 && Math.abs(k.py - hz.y) < 3) emit({ t: 'rm', id: hz.id });
    }
    return;
  }
  if (k.invuln > 0 || k.spin > 0 || k.resc > 0) return;
  // omvergeknald door een komeet
  for (const o of race.karts.values()) {
    if (o === e || !(o.kart ? o.kart.komeet > 0 : o.fx & 1)) continue;
    const [ox, oz] = posOf(o);
    const dx = k.x - ox, dz = k.z - oz;
    if (dx * dx + dz * dz < KOMEET_R * KOMEET_R && Math.abs(yOf(o) - k.py) < 3) { hitFeedback(e, k.hit(), 'Omvergeknald!'); return; }
  }
  for (const hz of race.hazards.values()) {
    const r = HAZ_R[hz.kind];
    if (!r) continue;
    const dx = k.x - hz.x, dz = k.z - hz.z;
    if (dx * dx + dz * dz < r * r && Math.abs(k.py - hz.y) < 2.5) {
      if (hz.kind !== 'banaan' && hz.o === e.id && now() - hz.born < 0.6) continue;
      const res = k.hit();
      if (!res) return;
      emit({ t: 'rm', id: hz.id });
      hitFeedback(e, res, hz.kind === 'banaan' ? 'Uitgegleden!' : 'Geraakt!');
      return;
    }
  }
}
// bal of raket langs de vangrail laten stuiteren; false = van de baan af
function bounceOrFall(hz, n) {
  const lim = track.hw[n.i] - 0.6;
  if (Math.abs(n.lat) > lim && track.railAt(n.i, n.lat)) {
    const s = Math.sign(n.lat), nx = track.nx[n.i] * s, nz = track.nz[n.i] * s;
    let dx = Math.sin(hz.h), dz = Math.cos(hz.h);
    const dot = dx * nx + dz * nz;
    if (dot > 0) { dx -= 2 * dot * nx; dz -= 2 * dot * nz; hz.h = Math.atan2(dx, dz); }
    hz.x -= nx * (Math.abs(n.lat) - lim);
    hz.z -= nz * (Math.abs(n.lat) - lim);
    return true;
  }
  return track.onRoad(n);
}
function updateHazards(dt, t) {
  const N = track.N;
  for (const hz of race.hazards.values()) {
    const age = t - hz.born, m = hz.mesh;
    if (hz.kind === 'groen') {
      if (age > 6) { removeHaz(hz.id); continue; }
      hz.x += Math.sin(hz.h) * 80 * dt;
      hz.z += Math.cos(hz.h) * 80 * dt;
      const n = track.nearest(hz.x, hz.z, hz.bi, hz.y);
      hz.bi = n.i;
      if (!bounceOrFall(hz, n)) { removeHaz(hz.id); continue; }
      hz.y = track.surfaceY(track.nearest(hz.x, hz.z, n.i, hz.y));
      m.position.set(hz.x, hz.y + 0.8 + Math.abs(Math.sin(age * 9)) * 0.6, hz.z);
      m.rotation.set(age * 12, hz.h, 0);
    } else if (hz.kind === 'rood') {
      if (age > 8) { removeHaz(hz.id); continue; }
      const tg = hz.tg && race.karts.get(hz.tg);
      const speed = 92;
      let tx, ty, tz, direct = false;
      if (tg && !rescuing(tg)) {
        const [gx, gz] = posOf(tg), gyy = yOf(tg);
        const d = Math.hypot(gx - hz.x, gz - hz.z);
        if (d < 30 && Math.abs(gyy - hz.y) < 6) { direct = true; tx = gx; tz = gz; ty = gyy; }
        else {
          // volg de baan en schuif alvast opzij naar de baan-positie van het doelwit
          const tn = track.nearest(gx, gz, -1, gyy);
          hz.ml += (tn.lat - hz.ml) * Math.min(1, dt * 2);
        }
      }
      if (direct) {
        const dx = tx - hz.x, dz = tz - hz.z, d = Math.hypot(dx, dz) || 1;
        hz.x += dx / d * speed * dt; hz.z += dz / d * speed * dt;
        hz.y += (ty - hz.y) * Math.min(1, dt * 8);
        hz.h = Math.atan2(dx, dz);
        hz.mi = track.nearest(hz.x, hz.z, Math.floor(hz.mi) % N, hz.y).i;
      } else {
        hz.mi = (hz.mi + speed * dt) % N;
        const i = Math.floor(hz.mi), j = (i + 1) % N, f = hz.mi - i;
        hz.ml = clamp(hz.ml, -track.hw[i] + 1, track.hw[i] - 1);
        hz.x = track.px[i] + (track.px[j] - track.px[i]) * f + track.nx[i] * hz.ml;
        hz.z = track.pz[i] + (track.pz[j] - track.pz[i]) * f + track.nz[i] * hz.ml;
        hz.y = track.py[i] + (track.py[j] - track.py[i]) * f + track.bank[i] * hz.ml;
        hz.h = track.heading(i);
      }
      m.position.set(hz.x, hz.y + 0.9, hz.z);
      m.rotation.set(0, hz.h, Math.sin(age * 20) * 0.15);
      if (m.userData.flame) m.userData.flame.scale.setScalar(0.8 + Math.random() * 0.5);
    } else if (hz.kind === 'bom') {
      if (!hz.boom) {
        if (!hz.landed) {
          hz.x += Math.sin(hz.h) * hz.sp * dt; hz.z += Math.cos(hz.h) * hz.sp * dt;
          hz.vy -= 22 * dt; hz.y += hz.vy * dt;
          const n = track.nearest(hz.x, hz.z, hz.bi, hz.y); hz.bi = n.i;
          if (track.onRoad(n) && hz.vy < 0 && hz.y <= track.surfaceY(n) + 0.6) { hz.landed = true; hz.y = track.surfaceY(n) + 0.6; }
        }
        m.position.set(hz.x, hz.y, hz.z);
        m.rotation.y += dt * 4;
        if (m.userData.spark) m.userData.spark.scale.setScalar(0.6 + Math.random() * 0.9);
        if (age >= BOM_FUSE) { explode(hz); continue; }
        // lontje knippert steeds sneller, bom zwelt een beetje op vlak voor de knal
        const left = BOM_FUSE - age;
        m.scale.setScalar(1 + Math.max(0, 0.4 - left) * (0.6 + 0.3 * Math.sin(age * 60)));
      }
    } else if (hz.kind === 'banaan') {
      if (age > 40) removeHaz(hz.id);
    }
  }
}
function explode(hz) {
  hz.boom = true;
  removeHaz(hz.id);
  spawnExplosion(hz.x, hz.y, hz.z, 6.5);
  // elke speler controleert alleen zijn eigen karts (en de host ook de bots)
  for (const e of race.karts.values()) {
    if (!e.kart) continue;
    const k = e.kart;
    const d = Math.hypot(k.x - hz.x, k.z - hz.z, k.py - hz.y);
    if (d < BOM_R) hitFeedback(e, k.hit(), 'BOEM!');
  }
}

// ---------- bots ----------
function aiInput(k, ai, t) {
  const N = track.N;
  const j = (k.ti + Math.round(9 + Math.max(0, k.v) * 0.45)) % N;
  // vlak voor een schans recht door het midden (over de boostplaat), anders een beetje slingeren
  const jump = track.gapAhead(k.ti, 75) >= 0;
  const off = jump ? 0 : Math.sin(t * 0.25 + ai.seed) * Math.max(0, track.hw[j] - 3) * 0.7;
  const tx = track.px[j] + track.nx[j] * off, tz = track.pz[j] + track.nz[j] * off;
  const diff = wrapA(Math.atan2(tx - k.x, tz - k.z) - k.h);
  return { steer: clamp(-diff * 2.8, -1, 1), brake: false, drift: false, gas: jump || !(Math.abs(diff) > 0.7 && k.v > 18) };
}
const autoPilot = { seed: 1.7, useAt: 0 };

// ---------- botsingen tussen karts ----------
function pushApart(e) {
  const k = e.kart;
  if (k.resc > 0 || k.komeet > 0) return;
  for (const o of race.karts.values()) {
    if (o === e || rescuing(o) || (o.kart ? o.kart.komeet > 0 : o.fx & 1) || Math.abs(yOf(o) - k.py) > 2) continue;
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
  return [e.id, +k.x.toFixed(2), +k.z.toFixed(2), +k.visYaw.toFixed(3), k.tot, k.fin ? 1 : 0, +k.ft.toFixed(2), k.driftLevel, k.boostLevel, +k.v.toFixed(1), +k.y.toFixed(2), +k.rescueFrac.toFixed(2), k.fx];
}
function receiveState(e, a) {
  e.buf.push({ t: now(), x: a[1], z: a[2], y: a[3], dr: a[7], b: a[8], v: a[9], hy: a[10] || 0, rs: a[11] || 0, fx: a[12] || 0 });
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
    e.dr = c.dr; e.b = c.b; e.v = c.v; e.rs = c.rs; e.fx = c.fx;
  } else {
    e.x = a.x; e.z = a.z; e.yaw = a.y; e.dr = a.dr; e.b = a.b; e.v = a.v; e.hy = a.hy; e.rs = a.rs; e.fx = a.fx;
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
const qTilt = new THREE.Quaternion(), qYaw = new THREE.Quaternion(), qGoal = new THREE.Quaternion();
function updateKartVisual(e, dt, x, y, z, yaw, steer, dr, boost, v, rs) {
  const m = e.mesh, u = m.userData;
  m.position.set(x, y, z);
  // kantelen mee met de weg (heuvels en schuine bochten)
  const n = track.nearest(x, z, e.vi ?? -1, y);
  e.vi = n.i;
  const gy = track.surfaceY(n), road = track.onRoad(n);
  const onGround = road && y - gy < 1.2 && y - gy > -1;
  tmpUp.set(onGround ? track.ux[n.i] : 0, onGround ? track.uy[n.i] : 1, onGround ? track.uz[n.i] : 0);
  qTilt.setFromUnitVectors(upY, tmpUp);
  qYaw.setFromAxisAngle(upY, yaw);
  qGoal.multiplyQuaternions(qTilt, qYaw);
  if (!e.qInit) { m.quaternion.copy(qGoal); e.qInit = true; } else m.quaternion.slerp(qGoal, 1 - Math.exp(-dt * 12));
  u.shadow.visible = road && y - gy < 10 && !rs;
  u.shadow.position.y = gy - y + 0.1;
  // Takeltje hangt boven een kart die teruggetakeld wordt
  if (rs > 0 && !e.tak) { e.tak = makeTakeltje(); if (e.tak) scene.add(e.tak); }
  if (e.tak) {
    e.tak.visible = rs > 0;
    if (rs > 0) {
      const drop = rs < 0.3 ? (1 - rs / 0.3) * 14 : rs > 0.85 ? (rs - 0.85) / 0.15 * 14 : 0;
      e.tak.position.set(x, y + 6.9 + drop, z);
      e.tak.rotation.y = yaw + Math.PI;
      if (e.tak.userData.prop) e.tak.userData.prop.rotation.y += dt * 30;
    }
  }
  for (const w of u.wheels) w.rotation.x += v * dt / 0.42;
  for (const p of u.frontPivots) p.rotation.y = -steer * 0.45;
  // turbovlammen in de kleur van de drift-turbo
  if (boost && u.flames[0]) u.flames[0].material.color.setHex(FLAME_COL[boost] || FLAME_COL[1]);
  for (const f of u.flames) { f.visible = !!boost; if (boost) f.scale.setScalar((0.8 + Math.random() * 0.6) * (boost >= 3 ? 1.3 : 1)); }
  // driftvonken: wit, dan blauw, paars en goud; groter bij een hoger niveau
  if (dr) u.sparkMat.color.setHex(DRIFT_COL[dr] || DRIFT_COL[1]);
  for (const s of u.sparks) {
    s.visible = dr > 0 && !rs;
    if (dr) { s.scale.setScalar((0.6 + Math.random() * 0.5) * (0.7 + dr * 0.25)); s.rotation.y += dt * 20; }
  }
  if (dr && !rs) emitSparks(e, dt, dr, yaw);
  // item-effecten: komeet en bubbelschild (ook zichtbaar bij de andere spelers)
  const fx = e.fx || 0;
  if (fx && !e.fxo) {
    e.fxo = { komeet: makeComet(), schild: makeShield() };
    for (const o of Object.values(e.fxo)) { o.visible = false; m.add(o); }
  }
  if (e.fxo) {
    e.fxo.komeet.visible = !!(fx & 1);
    e.fxo.schild.visible = !!(fx & 2);
    if (fx & 1) {
      e.fxo.komeet.userData.tail.scale.set(1, 1, 0.85 + Math.random() * 0.3);
      emitSparks(e, dt, 4, yaw);
    }
    if (fx & 2) e.fxo.schild.rotation.y += dt * 1.5;
  }
}

// ---------- driftvonken (deeltjes) ----------
const DRIFT_COL = [0, 0xfff3b0, 0x3fa9ff, 0xb44dff, 0xffc21a];
const FLAME_COL = [0, 0xffa31a, 0x4cc9ff, 0xc77dff, 0xffd23a];
const sparkGeo = new THREE.OctahedronGeometry(0.24);
const sparkMats = DRIFT_COL.map((c) => new THREE.MeshBasicMaterial({ color: c }));
const fxGroup = new THREE.Group();
scene.add(fxGroup);
const sparkPool = [];
const sparkTmp = new THREE.Vector3();
function emitSparks(e, dt, dr, yaw) {
  e.sparkAcc = (e.sparkAcc || 0) + dt * (25 + dr * 18);
  const fx = Math.sin(yaw), fz = Math.cos(yaw), rx = -fz, rz = fx;
  while (e.sparkAcc >= 1) {
    e.sparkAcc--;
    let p = sparkPool.find((q) => q.life <= 0);
    if (!p) {
      if (sparkPool.length >= 500) return;
      p = { mesh: new THREE.Mesh(sparkGeo, sparkMats[1]), life: 0 };
      fxGroup.add(p.mesh); sparkPool.push(p);
    }
    const side = Math.random() < 0.5 ? -1 : 1;
    sparkTmp.set(side * 0.95, 0.15, -1.0);
    e.mesh.localToWorld(sparkTmp);
    p.mesh.position.copy(sparkTmp);
    p.mesh.material = sparkMats[dr] || sparkMats[1];
    p.mesh.visible = true;
    const back = 3 + Math.random() * 5, out = 1 + Math.random() * 3.5;
    p.vx = -fx * back + rx * side * out; p.vz = -fz * back + rz * side * out;
    p.vy = 2 + Math.random() * 3.5;
    p.max = p.life = 0.18 + Math.random() * 0.16;
    p.size = 0.8 + dr * 0.35;
  }
}
function updateSparks(dt) {
  for (const p of sparkPool) {
    if (p.life <= 0) continue;
    p.life -= dt;
    if (p.life <= 0) { p.mesh.visible = false; continue; }
    p.vy -= 14 * dt;
    p.mesh.position.x += p.vx * dt; p.mesh.position.y += p.vy * dt; p.mesh.position.z += p.vz * dt;
    p.mesh.scale.setScalar(p.size * (p.life / p.max));
    p.mesh.rotation.x += dt * 15;
  }
}
function clearSparks() { for (const p of sparkPool) { p.life = 0; p.mesh.visible = false; } }

const camPos = new THREE.Vector3(), camTmp = new THREE.Vector3();
let camYaw = 0, camY = 0;
function snapCamera(x, y, z, yaw) {
  camYaw = yaw; camY = y;
  camPos.set(x - Math.sin(yaw) * 8.5, y + 3.8, z - Math.cos(yaw) * 8.5);
  camera.position.copy(camPos);
  camera.lookAt(x, y + 1.2, z);
}
// refY: de hoogte die de camera volgt (blijft bij de weg als je naar beneden valt)
let camWide = 0;
function followCamera(dt, x, y, z, refY, heading, boosting, wide = 0, speed = 0) {
  camYaw += wrapA(heading - camYaw) * (1 - Math.exp(-dt * 6));
  camY += (refY - camY) * (1 - Math.exp(-dt * 7));
  camWide += (wide - camWide) * (1 - Math.exp(-dt * 4)); // bij takelen iets uitzoomen
  const dist = 8.5 + camWide * 7;
  camTmp.set(x - Math.sin(camYaw) * dist, camY + 3.8 + camWide * 5, z - Math.cos(camYaw) * dist);
  camPos.lerp(camTmp, 1 - Math.exp(-dt * 22));
  camera.position.copy(camPos);
  if (camShake > 0) { // schok van een explosie vlakbij
    camera.position.x += (Math.random() - 0.5) * camShake * 1.4;
    camera.position.y += (Math.random() - 0.5) * camShake * 1.0;
    camera.position.z += (Math.random() - 0.5) * camShake * 1.4;
  }
  camera.lookAt(x + Math.sin(camYaw) * 4 * (1 - camWide), Math.max(y, camY - 10) + 1.3 + camWide * 3, z + Math.cos(camYaw) * 4 * (1 - camWide));
  // hoe sneller, hoe wijder het beeld (snelheidsgevoel)
  const fov = baseFov + clamp((Math.abs(speed) - 28) * 0.35, 0, 11) + (boosting ? 7 : 0);
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
const STOP = { steer: 0, brake: false, drift: false, gas: false, stop: true }; // online pauzemenu open
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
    const ii = !go ? IDLE : k.fin ? aiInput(k, autoPilot, t) : pauseOpen ? STOP : readInput();
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
    if (k.landFx) { if (k.landFx > 6) sfx.bump(); k.landFx = 0; }
    if (k.lvlFx) { sfx.beep([0, 0, 700, 950, 1250][k.lvlFx] || 700, 0.09, 'triangle', 0.12); k.lvlFx = 0; }
    if (k.fellFx) {
      k.fellFx = false;
      toast('Takeltje haalt je op!');
      sfx.hit();
      try { navigator.vibrate?.(120); } catch { /* */ }
    }
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
      e.hy = k.py; e.rs = k.rescueFrac; e.fx = k.fx;
      updateKartVisual(e, dt, k.x, k.y, k.z, k.visYaw, k.steerVis, k.driftLevel, k.boostLevel, k.v, e.rs);
    } else {
      interp(e, rt);
      updateKartVisual(e, dt, e.x, e.hy || 0, e.z, e.yaw, 0, e.dr, e.b, e.v, e.rs || 0);
    }
  }

  updateHazards(dt, t);
  updateSparks(dt);
  updateExplosions(dt);
  race.boxes.forEach((b, i) => {
    if (!b.active && t >= b.back) { b.active = true; boxMeshes[i].visible = true; }
  });
  for (const m of boxMeshes) { m.rotation.y += dt * 1.5; m.rotation.x += dt * 0.7; m.position.y = m.userData.by + Math.sin(t * 2 + m.position.x) * 0.25; }

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
    const fk = focus.kart;
    if (fk) followCamera(dt, fk.x, fk.py, fk.z, fk.camY, fk.h, fk.boost > 0, fk.resc > 0 ? 1 : 0, fk.v);
    else followCamera(dt, focus.x, focus.hy || 0, focus.z, focus.hy || 0, focus.yaw, focus.b, focus.rs > 0 ? 1 : 0, focus.v);
  }
  if (mine) sfx.engine(Math.abs(mine.kart.v) / 75, mode !== 'results');

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
    const icon = k.item === '?' ? ITEMS[ITEM_KEYS[Math.floor(t * 12) % ITEM_KEYS.length]].icon : itemIcon(k.item, k.uses);
    setHTML('item', icon);
    setHTML('bItem', k.item && k.item !== '?' ? itemIcon(k.item, k.uses) : 'ITEM');
    $('bItem').classList.toggle('has', !!k.item && k.item !== '?');
    drawMinimap();
  }
}

function menuCamera(t) {
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  const r = Math.max(maxX - minX, maxZ - minZ) * 0.8;
  camera.position.set(cx + Math.cos(t * 0.05) * r, 150, cz + Math.sin(t * 0.05) * r);
  camera.lookAt(cx, 20, cz);
  for (const m of boxMeshes) { m.rotation.y += 0.02; }
}

function loop() {
  requestAnimationFrame(loop);
  const t = now();
  const dt = clamp(t - lastT, 0, 0.05);
  lastT = t;
  if (race) { if (!paused) updateRace(dt, t); }
  else menuCamera(t);
  renderer.render(scene, camera);
}
loop();

// handig voor testen in de console
window.knal = { get race() { return race; }, net, track, lobby: () => lobby };
