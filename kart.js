import * as THREE from 'three';

export const KART_COLORS = ['#e63946', '#2a9df4', '#2ec27e', '#f5c211', '#9b5de5', '#ff7f11', '#ff5fa2', '#20c9c9'];
const SPIN_T = 1.3;
const SCHANS_VY = 5;       // extra zetje omhoog als je van een schans af rijdt
export const RESC_T = 2.2; // zo lang duurt het terugtakelen door Takeltje
const BRAKE = 70, BOOST_MUL = 1.32;
// snelheidsklassen. Zwaartekracht (m/s²) is sterker dan echt en groeit mee met de snelheid,
// zodat je bij elke klasse de schansen haalt maar niet over de landing heen vliegt.
export const CLASSES = {
  100: { cc: 100, player: 34, bot: 31, botSpread: 2.5, accel: 22, boostAccel: 55, gravity: 16 },
  150: { cc: 150, player: 43, bot: 39, botSpread: 3.2, accel: 27, boostAccel: 65, gravity: 20 },
  200: { cc: 200, player: 53, bot: 48, botSpread: 4, accel: 32, boostAccel: 75, gravity: 24 },
};
export const DEFAULT_CC = 150;
// driften: hoe langer je drift, hoe hoger het niveau (blauw, paars, goud) en hoe langer de turbo
export const DRIFT_LEVELS = [{ at: 0.75, boost: 0.7 }, { at: 1.6, boost: 1.15 }, { at: 2.5, boost: 1.7 }];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrapA = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const smooth = (t) => t * t * (3 - 2 * t);

// Rijgedrag van één kart (arcade-stijl). Vooruit = (sin h, cos h), py = hoogte.
export class Kart {
  constructor(track, cls = CLASSES[DEFAULT_CC]) { this.track = track; this.cls = cls; this.maxSpeed = cls.bot; this.place(0, 0, 0); }

  place(x, z, h) {
    Object.assign(this, {
      x, z, h, yaw: h, visYaw: h, v: 0, drift: 0, charge: 0, boost: 0, spin: 0, spinAng: 0,
      invuln: 0, hop: 0, offroad: false, ti: -1, tot: 0, fin: false, ft: 0, item: null, roll: 0,
      steerVis: 0, bump: false, boostFx: false, padHit: false,
      py: 0, vy: 0, air: false, groundY: 0, safeI: -1, resc: 0, rFrom: null, rTo: null, landFx: 0, fellFx: false,
      boostLvl: 0, lvlFx: 0, steerS: 0, uses: 0,
      komeet: 0, kI: 0, kLat: 0, shield: 0,
    });
    const n = this.track.nearest(x, z, -1);
    this.py = this.groundY = this.track.surfaceY(n);
  }

  initProgress() {
    const n = this.track.nearest(this.x, this.z, -1, this.py);
    this.ti = n.i; this.safeI = n.i;
    this.tot = n.i > this.track.N / 2 ? n.i - this.track.N : n.i;
  }

  get y() { return this.py + (this.hop > 0 && !this.air ? Math.sin((this.hop / 0.22) * Math.PI) * 0.45 : 0); }
  // 0 = niet driften, 1 = driften (wit), 2 = blauw, 3 = paars, 4 = goud
  get driftLevel() {
    if (!this.drift) return 0;
    let l = 1;
    for (const d of DRIFT_LEVELS) if (this.charge >= d.at) l++;
    return l;
  }
  // 0 = geen turbo, 1 = gewone turbo, 2-4 = drift-turbo (blauw, paars, goud)
  get boostLevel() { return this.boost > 0 ? Math.max(1, this.boostLvl) : 0; }
  // 0 = niet aan het takelen, anders hoe ver (0..1)
  get rescueFrac() { return this.resc > 0 ? 1 - this.resc / RESC_T : 0; }
  // hoogte waar de camera naartoe kijkt: bij een val blijft hij bij de weg
  get camY() { return this.resc > 0 ? this.py : this.air ? Math.max(this.py, this.groundY - 1) : this.py; }

  giveBoost(s, lvl = 0) { if (this.boost < s) { this.boost = s; this.boostFx = true; this.boostLvl = lvl; } }

  // bits voor het netwerk: 1 = komeet, 2 = schild
  get fx() { return (this.komeet > 0 ? 1 : 0) | (this.shield > 0 ? 2 : 0); }

  // geraakt: false = niets gebeurd, 'schild' = schild vangt het op, true = spinnen
  hit() {
    if (this.invuln > 0 || this.spin > 0 || this.resc > 0 || this.komeet > 0) return false;
    if (this.shield > 0) { this.shield = 0; this.invuln = 0.6; return 'schild'; }
    this.spin = SPIN_T; this.invuln = 2.6; this.drift = 0; this.charge = 0; this.boost = 0;
    return true;
  }

  // ☄️ Komeet: een paar seconden zelf over de middenlijn van de baan vliegen
  startKomeet(t = 6) {
    if (this.resc > 0) return false;
    const T = this.track;
    const n = T.nearest(this.x, this.z, this.ti, this.py);
    this.komeet = t; this.kI = n.i + clamp(n.along, -0.5, 0.5); this.kLat = n.lat;
    this.spin = 0; this.spinAng = 0; this.drift = 0; this.charge = 0; this.air = false; this.vy = 0;
    this.boostFx = true;
    return true;
  }

  updateKomeet(dt) {
    const T = this.track, N = T.N;
    const speed = this.cls.player * 1.55;
    this.komeet -= dt;
    this.kI = (this.kI + speed * dt) % N;
    this.kLat *= Math.exp(-dt * 2.5);
    const i = Math.floor(this.kI), j = (i + 1) % N, f = this.kI - i;
    const cx = T.px[i] + (T.px[j] - T.px[i]) * f, cz = T.pz[i] + (T.pz[j] - T.pz[i]) * f;
    this.x = cx + T.nx[i] * this.kLat; this.z = cz + T.nz[i] * this.kLat;
    this.py = T.py[i] + (T.py[j] - T.py[i]) * f + T.bank[i] * this.kLat + 0.6;
    this.groundY = this.py; this.safeI = i;
    this.h = T.heading(i); this.yaw = this.visYaw = this.h; this.v = speed;
    let d = i - this.ti;
    if (d > N / 2) d -= N; else if (d < -N / 2) d += N;
    this.tot += d; this.ti = i;
    // nooit boven een gat stoppen: dan nog even doorvliegen
    if (this.komeet <= 0 && (T.gapAhead((i + N - 6) % N, 14) >= 0)) this.komeet = 0.05;
    if (this.komeet <= 0) {
      this.komeet = 0; this.py -= 0.6; this.v = this.maxSpeed; this.invuln = 1.2;
      this.giveBoost(0.8);
    }
  }

  update(dt, inp) {
    const T = this.track, N = T.N;
    const raw = clamp(inp.steer || 0, -1, 1);
    // stuur vloeiend: niet in één klap van rechtdoor naar vol in de bocht
    const back = Math.abs(raw) < Math.abs(this.steerS) || Math.sign(raw) !== Math.sign(this.steerS);
    const rate = back ? 7 : 3.5;
    this.steerS += clamp(raw - this.steerS, -rate * dt, rate * dt);
    let steer = this.steerS;
    if (this.invuln > 0) this.invuln -= dt;
    if (this.hop > 0) this.hop = Math.max(0, this.hop - dt);
    if (this.resc > 0) { this.rescue(dt); return; }
    if (this.shield > 0) this.shield -= dt;
    if (this.komeet > 0) { this.updateKomeet(dt); return; }
    if (this.spin > 0) {
      this.spin -= dt;
      this.v *= Math.pow(0.2, dt);
      steer = 0;
      if (this.spin <= 0) this.spin = 0;
      this.spinAng = (1 - this.spin / SPIN_T) * Math.PI * 4;
    } else this.spinAng = 0;
    const control = this.spin <= 0;

    const n0 = T.nearest(this.x, this.z, this.ti, this.py);
    if (!this.air && T.isPad(n0.i, n0.lat)) { if (this.boost < 0.5) this.padHit = true; this.giveBoost(0.9); }

    let max = this.maxSpeed;
    if (this.boost > 0) { this.boost -= dt; max *= BOOST_MUL; if (this.boost <= 0) this.boostLvl = 0; }

    if (inp.stop) {
      // pauzemenu open (online): rustig tot stilstand remmen, niet achteruit
      this.v = this.v > 0 ? Math.max(0, this.v - BRAKE * dt) : Math.min(0, this.v + BRAKE * dt);
      this.drift = 0; this.charge = 0;
    } else if (control && !this.air) {
      if (inp.brake) { this.v -= (this.v > 0 ? BRAKE : 20) * dt; if (this.v < -12) this.v = -12; }
      else if (inp.gas !== false) { if (this.v < max) this.v = Math.min(max, this.v + (this.boost > 0 ? this.cls.boostAccel : this.cls.accel) * dt); }
      else this.v *= Math.pow(0.4, dt);
    }
    if (this.v > max && !this.air) this.v = Math.max(max, this.v - 45 * dt);

    // driften: knop vasthouden tijdens sturen. Hoe langer, hoe hoger het niveau; loslaten = turbo
    if (control && !this.air && inp.drift && !this.drift && Math.abs(raw) > 0.25 && this.v > 15 && !inp.brake) {
      this.drift = Math.sign(raw); this.charge = 0; this.hop = 0.22;
    }
    if (this.drift) {
      if (!control || this.v < 10 || inp.brake) { this.drift = 0; this.charge = 0; }
      else if (!inp.drift) {
        const lvl = this.driftLevel;
        if (lvl >= 2) this.giveBoost(DRIFT_LEVELS[lvl - 2].boost, lvl);
        this.drift = 0; this.charge = 0;
      }
    }

    const sf = clamp(Math.abs(this.v) / 7, 0, 1) * (this.v < 0 ? -1 : 1);
    let turn;
    if (this.drift) {
      // s = -1: naar buiten sturen (flauwe boog), 0: los (middel), 1: de bocht in (scherp)
      const s = steer * this.drift;
      turn = this.drift * (0.35 + 1.35 * (s + 1) / 2);
      // je laadt altijd op, ook in een flauwe bocht; de bocht in sturen gaat iets sneller
      const before = this.driftLevel;
      this.charge += dt * (0.85 + 0.35 * Math.max(0, s));
      if (this.driftLevel > before) this.lvlFx = this.driftLevel;
    } else turn = steer * 2.0 * (1 - Math.min(0.15, Math.abs(this.v) / 350));
    if (this.air) turn *= 0.5;
    this.h = wrapA(this.h - turn * sf * dt);
    this.steerVis += (steer - this.steerVis) * Math.min(1, dt * 10);

    this.x += Math.sin(this.h) * this.v * dt;
    this.z += Math.cos(this.h) * this.v * dt;

    // vangrails (alleen waar ze staan; elders kun je van de baan af)
    let n = T.nearest(this.x, this.z, n0.i, this.py);
    const lim = T.hw[n.i] - 0.5;
    this.bump = false;
    if (Math.abs(n.lat) > lim && T.railAt(n.i, n.lat) && this.py > T.surfaceY(n) - 1.5) {
      const s = Math.sign(n.lat), over = Math.abs(n.lat) - lim;
      this.x -= T.nx[n.i] * s * over; this.z -= T.nz[n.i] * s * over;
      let dh = wrapA(T.heading(n.i) - this.h);
      if (Math.abs(dh) > Math.PI / 2) dh = wrapA(dh + Math.PI);
      if (Math.abs(Math.sin(dh)) > 0.3 && Math.abs(this.v) > 8) { this.v *= 0.6; this.bump = true; }
      this.h = wrapA(this.h + dh * 0.35);
      this.v *= Math.pow(0.4, dt);
      n = T.nearest(this.x, this.z, n.i, this.py);
    }

    // hoogte: op de weg blijven, of vliegen/vallen
    const gy = T.surfaceY(n), road = T.onRoad(n);
    if (!this.air) {
      if (road) {
        this.vy += ((gy - this.py) / Math.max(dt, 1e-3) - this.vy) * Math.min(1, dt * 12);
        this.py = gy; this.groundY = gy; this.safeI = n.i;
      } else {
        this.air = true;
        this.vy = clamp(this.vy, -6, 10);
        if (T.gat[n.i]) this.vy = Math.max(this.vy, 0) + SCHANS_VY;
        this.drift = 0; this.charge = 0;
      }
    }
    if (this.air) {
      this.vy -= this.cls.gravity * dt;
      this.py += this.vy * dt;
      if (road && this.vy <= 0 && this.py <= gy + 0.05 && this.py > gy - 2) {
        this.landFx = -this.vy; this.air = false; this.vy = 0; this.py = gy; this.groundY = gy;
      } else if (this.py < this.groundY - 14) this.startRescue(n.i);
    }

    // voortgang (voor rondes en positie)
    if (this.resc <= 0) {
      let d = n.i - this.ti;
      if (d > N / 2) d -= N; else if (d < -N / 2) d += N;
      this.tot += d; this.ti = n.i;
    }

    this.yaw += wrapA(this.h - this.drift * 0.36 - this.yaw) * Math.min(1, dt * 6);
    this.visYaw = this.yaw + this.spinAng;
  }

  // van de baan gevallen: Takeltje komt je halen
  startRescue(fallI) {
    const T = this.track, N = T.N;
    let ti = this.safeI >= 0 ? this.safeI : this.ti;
    const inGap = T.gat[fallI] || T.gat[ti];
    const g = T.gapAhead(ti, 50);
    if (inGap || (g >= 0 && T.gapAhead(ti, 0) < 0 && ((g - ti + N) % N) < 6)) {
      // in het gat van een schans gevallen: na de landing weer neerzetten
      let j = inGap ? (T.gat[fallI] ? fallI : ti) : g;
      while (T.gat[j]) j = (j + 1) % N;
      ti = (j + 4) % N;
    } else if (g >= 0) {
      ti = (g - 55 + N) % N; // vlak voor een schans: genoeg aanloop geven
    }
    this.resc = RESC_T;
    this.rFrom = { x: this.x, y: this.py, z: this.z, h: this.h };
    this.rTo = { x: T.px[ti], y: T.py[ti], z: T.pz[ti], h: T.heading(ti), i: ti };
    this.v = 0; this.vy = 0; this.drift = 0; this.charge = 0; this.boost = 0; this.spin = 0; this.spinAng = 0;
    this.fellFx = true;
  }

  rescue(dt) {
    this.resc -= dt;
    const f = 1 - Math.max(0, this.resc) / RESC_T, a = this.rFrom, b = this.rTo;
    if (f > 0.3) {
      const q = smooth(clamp((f - 0.3) / 0.5, 0, 1));
      this.x = a.x + (b.x - a.x) * q;
      this.z = a.z + (b.z - a.z) * q;
      this.py = a.y + (b.y + 1.5 - a.y) * q + Math.sin(q * Math.PI) * 6;
      if (f > 0.8) this.py = b.y + 1.5 * (1 - (f - 0.8) / 0.2);
      this.h = a.h + wrapA(b.h - a.h) * q;
      this.yaw = this.visYaw = this.h;
    }
    if (this.resc <= 0) {
      const N = this.track.N;
      Object.assign(this, { x: b.x, z: b.z, py: b.y, h: b.h, yaw: b.h, visYaw: b.h, air: false, vy: 0,
        groundY: b.y, invuln: 1.5, safeI: b.i, resc: 0 });
      let d = b.i - this.ti;
      if (d > N / 2) d -= N; else if (d < -N / 2) d += N;
      this.tot += d; this.ti = b.i;
    }
  }
}

// ---------- Blender-model (models/knalkart.glb) ----------
// Wordt op de achtergrond geladen. Lukt dat niet, dan valt het spel terug op de blokjes-kart.
let MODEL = null;
const sharedMats = new Map();
const colorMats = new Map();

async function loadKartModel(url = 'models/knalkart.glb') {
  try {
    const [{ GLTFLoader }, { mergeGeometries }] = await Promise.all([
      import('three/addons/loaders/GLTFLoader.js'),
      import('three/addons/utils/BufferGeometryUtils.js'),
    ]);
    const gltf = await new GLTFLoader().loadAsync(url);
    const root = gltf.scene;
    root.updateMatrixWorld(true);
    const mats = new Map();
    // alle meshes onder `node` samenvoegen tot één geometrie met een groep per materiaal
    const merge = (meshes, frame) => {
      const inv = frame.matrixWorld.clone().invert();
      const byMat = new Map();
      for (const m of meshes) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', m.geometry.attributes.position);
        geo.setAttribute('normal', m.geometry.attributes.normal);
        geo.setIndex(m.geometry.index);
        const g2 = geo.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
        const name = m.material.name;
        mats.set(name, m.material);
        if (!byMat.has(name)) byMat.set(name, []);
        byMat.get(name).push(g2);
      }
      const names = [...byMat.keys()];
      return { geo: mergeGeometries(names.map((n) => mergeGeometries(byMat.get(n))), true), names };
    };
    const wheelNodes = [];
    root.traverse((o) => { if (/^Kart_Wheel_/.test(o.name)) wheelNodes.push(o); });
    const inWheel = new Set();
    const wheels = wheelNodes.map((w) => {
      const meshes = [];
      w.traverse((o) => { if (o.isMesh) { meshes.push(o); inWheel.add(o); } });
      const pos = new THREE.Vector3().setFromMatrixPosition(w.matrixWorld);
      return { pos, front: pos.z > 0, ...merge(meshes, w) };
    });
    const bodyMeshes = [];
    root.traverse((o) => { if (o.isMesh && !inWheel.has(o)) bodyMeshes.push(o); });
    MODEL = { body: merge(bodyMeshes, root), wheels };
    for (const [name, m] of mats) {
      sharedMats.set(name, new THREE.MeshLambertMaterial({
        color: m.color.clone(),
        emissive: name === 'Kart_Light' ? 0xffffff : 0x000000,
      }));
    }
  } catch (err) {
    console.warn('Kartmodel niet geladen, blokjes-kart wordt gebruikt', err);
  }
}
loadKartModel();

// ---------- Takeltje (takelt je terug als je van de baan valt) ----------
let TAK = null;
(async () => {
  try {
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const gltf = await new GLTFLoader().loadAsync('models/takeltje.glb');
    const mats = new Map();
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      const m = o.material;
      if (!mats.has(m.name)) {
        const glow = m.name === 'SB_Tak_Oog';
        mats.set(m.name, glow ? new THREE.MeshBasicMaterial({ color: m.color })
          : new THREE.MeshLambertMaterial({ color: m.color, emissive: m.color.clone().multiplyScalar(0.25) }));
      }
      o.material = mats.get(m.name);
    });
    TAK = gltf.scene;
  } catch (err) { console.warn('Takeltje niet geladen', err); }
})();

export function makeTakeltje() {
  if (!TAK) return null;
  const t = TAK.clone(true);
  t.scale.setScalar(1.3);
  t.userData.prop = t.getObjectByName('Takeltje_Propeller');
  return t;
}

// carrosserie krijgt de spelerskleur, de racestrepen worden wit
function kartMat(name, color) {
  if (name !== 'Kart_Body' && name !== 'Kart_Stripe') return sharedMats.get(name);
  const key = name + color;
  if (!colorMats.has(key)) {
    colorMats.set(key, new THREE.MeshLambertMaterial({ color: name === 'Kart_Body' ? new THREE.Color(color) : 0xffffff }));
  }
  return colorMats.get(key);
}

function addKartFx(g, exhausts, flameZ, flameY, sparkZ) {
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xffa31a, transparent: true, opacity: 0.9 });
  const flameGeo = new THREE.ConeGeometry(0.26, 1.1, 8).rotateX(-Math.PI / 2);
  const flames = exhausts.map((x) => {
    const f = new THREE.Mesh(flameGeo, flameMat); f.position.set(x, flameY, flameZ); f.visible = false; g.add(f); return f;
  });
  const sparkMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const sparks = [-1, 1].map((s) => {
    const sp = new THREE.Mesh(new THREE.OctahedronGeometry(0.22), sparkMat);
    sp.position.set(s * 0.95, 0.2, sparkZ); sp.visible = false; g.add(sp); return sp;
  });
  const sh = new THREE.Mesh(new THREE.CircleGeometry(1.5, 18).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }));
  sh.position.y = 0.1; sh.scale.set(1, 1, 1.35); g.add(sh);
  return { flames, sparks, sparkMat, shadow: sh };
}

export function makeKartMesh(color) {
  if (!MODEL) return makeBoxKart(color);
  const g = new THREE.Group();
  const { body } = MODEL;
  g.add(new THREE.Mesh(body.geo, body.names.map((n) => kartMat(n, color))));
  const wheels = [], frontPivots = [];
  for (const w of MODEL.wheels) {
    const pivot = new THREE.Group(); pivot.position.copy(w.pos); g.add(pivot);
    const mesh = new THREE.Mesh(w.geo, w.names.map((n) => kartMat(n, color)));
    pivot.add(mesh); wheels.push(mesh);
    if (w.front) frontPivots.push(pivot);
  }
  g.userData = { wheels, frontPivots, ...addKartFx(g, [-0.16, 0.16], -2.05, 0.33, -1.35) };
  return g;
}

function makeBoxKart(color) {
  const g = new THREE.Group();
  const c = new THREE.Color(color);
  const mBody = new THREE.MeshLambertMaterial({ color: c });
  const mTrim = new THREE.MeshLambertMaterial({ color: c.clone().multiplyScalar(0.6) });
  const mDark = new THREE.MeshLambertMaterial({ color: 0x26262e });
  const mMetal = new THREE.MeshLambertMaterial({ color: 0xc8ccd4 });
  const mWhite = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const add = (geo, mat, x, y, z, parent = g) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m; };

  add(new THREE.BoxGeometry(1.5, 0.35, 2.7), mBody, 0, 0.45, 0);
  add(new THREE.BoxGeometry(1.9, 0.18, 0.5), mTrim, 0, 0.42, 1.45);
  add(new THREE.BoxGeometry(1.1, 0.3, 0.9), mBody, 0, 0.7, 0.95);
  for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.22, 0.28, 2.3), mTrim, s * 0.86, 0.48, -0.05);
  add(new THREE.BoxGeometry(0.9, 0.6, 0.25), mDark, 0, 0.9, -0.75);
  // coureur
  add(new THREE.BoxGeometry(0.75, 0.65, 0.5), mTrim, 0, 1.05, -0.35);
  add(new THREE.SphereGeometry(0.42, 14, 10), mBody, 0, 1.65, -0.3);
  add(new THREE.BoxGeometry(0.62, 0.22, 0.3), mDark, 0, 1.66, -0.06);
  add(new THREE.BoxGeometry(0.12, 0.5, 0.7), mWhite, 0, 1.9, -0.32);
  const sw = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.05, 6, 14), mDark);
  sw.position.set(0, 1.0, 0.25); sw.rotation.x = -0.6; g.add(sw);
  // spoiler + uitlaten
  for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.08, 0.5, 0.08), mDark, s * 0.5, 0.85, -1.3);
  add(new THREE.BoxGeometry(1.8, 0.1, 0.45), mBody, 0, 1.12, -1.35);
  const exGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.4, 8).rotateX(Math.PI / 2);
  for (const s of [-1, 1]) add(exGeo, mMetal, s * 0.35, 0.55, -1.45);
  // wielen
  const wg = new THREE.CylinderGeometry(0.42, 0.42, 0.42, 14).rotateZ(Math.PI / 2);
  const hub = new THREE.BoxGeometry(0.44, 0.5, 0.12);
  const wheels = [], frontPivots = [];
  for (const [x, z, front] of [[0.95, 0.95, 1], [-0.95, 0.95, 1], [0.95, -0.95, 0], [-0.95, -0.95, 0]]) {
    const pivot = new THREE.Group(); pivot.position.set(x, 0.42, z); g.add(pivot);
    const w = new THREE.Mesh(wg, mDark); pivot.add(w);
    w.add(new THREE.Mesh(hub, mMetal));
    wheels.push(w);
    if (front) frontPivots.push(pivot);
  }
  // turbovlammen
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xffa31a, transparent: true, opacity: 0.9 });
  const flameGeo = new THREE.ConeGeometry(0.26, 1.1, 8).rotateX(-Math.PI / 2);
  const flames = [-1, 1].map((s) => { const f = add(flameGeo, flameMat, s * 0.35, 0.55, -2.0); f.visible = false; return f; });
  // driftvonken
  const sparkMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const sparks = [-1, 1].map((s) => { const sp = add(new THREE.OctahedronGeometry(0.22), sparkMat, s * 0.95, 0.2, -1.35); sp.visible = false; return sp; });
  // schaduw
  const sh = new THREE.Mesh(new THREE.CircleGeometry(1.5, 18).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }));
  sh.position.y = 0.1; sh.scale.set(1, 1, 1.35); g.add(sh);

  g.userData = { wheels, frontPivots, flames, sparks, sparkMat, shadow: sh };
  return g;
}

export function makeLabel(text, color) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const x = c.getContext('2d');
  x.font = 'bold 32px system-ui, sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  const w = Math.min(250, x.measureText(text).width + 30);
  x.fillStyle = 'rgba(0,0,0,0.55)';
  x.beginPath();
  if (x.roundRect) x.roundRect((256 - w) / 2, 8, w, 48, 22); else x.rect((256 - w) / 2, 8, w, 48);
  x.fill();
  x.strokeStyle = color; x.lineWidth = 4; x.stroke();
  x.fillStyle = '#fff';
  x.fillText(text, 128, 33);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  // vaste grootte op het scherm, hoe ver de kart ook is
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, sizeAttenuation: false }));
  s.scale.set(0.16, 0.04, 1);
  s.position.set(0, 3.0, 0);
  s.renderOrder = 10;
  return s;
}
