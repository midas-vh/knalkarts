import * as THREE from 'three';

export const KART_COLORS = ['#e63946', '#2a9df4', '#2ec27e', '#f5c211', '#9b5de5', '#ff7f11', '#ff5fa2', '#20c9c9'];
const SPIN_T = 1.3;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrapA = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

// Rijgedrag van één kart (arcade-stijl). Vooruit = (sin h, cos h).
export class Kart {
  constructor(track) { this.track = track; this.maxSpeed = 28; this.place(0, 0, 0); }

  place(x, z, h) {
    Object.assign(this, {
      x, z, h, yaw: h, visYaw: h, v: 0, drift: 0, charge: 0, boost: 0, spin: 0, spinAng: 0,
      invuln: 0, hop: 0, offroad: false, ti: -1, tot: 0, fin: false, ft: 0, item: null, roll: 0,
      steerVis: 0, bump: false, boostFx: false, padHit: false,
    });
  }

  initProgress() {
    const n = this.track.nearest(this.x, this.z, -1);
    this.ti = n.i;
    this.tot = n.i > this.track.N / 2 ? n.i - this.track.N : n.i;
  }

  get y() { return this.hop > 0 ? Math.sin((this.hop / 0.22) * Math.PI) * 0.45 : 0; }
  get driftLevel() { return !this.drift ? 0 : this.charge > 1.7 ? 3 : this.charge > 0.8 ? 2 : 1; }

  giveBoost(s) { if (this.boost < s) { this.boost = s; this.boostFx = true; } }

  hit() {
    if (this.invuln > 0 || this.spin > 0) return false;
    this.spin = SPIN_T; this.invuln = 2.6; this.drift = 0; this.charge = 0; this.boost = 0;
    return true;
  }

  update(dt, inp) {
    const T = this.track, N = T.N;
    let steer = clamp(inp.steer || 0, -1, 1);
    if (this.invuln > 0) this.invuln -= dt;
    if (this.hop > 0) this.hop = Math.max(0, this.hop - dt);
    if (this.spin > 0) {
      this.spin -= dt;
      this.v *= Math.pow(0.2, dt);
      steer = 0;
      if (this.spin <= 0) this.spin = 0;
      this.spinAng = (1 - this.spin / SPIN_T) * Math.PI * 4;
    } else this.spinAng = 0;
    const control = this.spin <= 0;

    const n0 = T.nearest(this.x, this.z, this.ti);
    this.offroad = Math.abs(n0.lat) > T.halfWidth + 0.6;
    if (T.isPad(n0.i, n0.lat)) { if (this.boost < 0.5) this.padHit = true; this.giveBoost(0.9); }

    let max = this.maxSpeed;
    if (this.boost > 0) { this.boost -= dt; max *= 1.45; } else if (this.offroad) max *= 0.45;

    if (control) {
      if (inp.brake) { this.v -= (this.v > 0 ? 45 : 15) * dt; if (this.v < -9) this.v = -9; }
      else if (inp.gas !== false) { if (this.v < max) this.v = Math.min(max, this.v + (this.boost > 0 ? 45 : 19) * dt); }
      else this.v *= Math.pow(0.4, dt);
    }
    if (this.v > max) this.v = Math.max(max, this.v - 30 * dt);

    // driften: knop vasthouden tijdens sturen, loslaten = turbo
    if (control && inp.drift && !this.drift && Math.abs(steer) > 0.25 && this.v > 11 && !inp.brake) {
      this.drift = Math.sign(steer); this.charge = 0; this.hop = 0.22;
    }
    if (this.drift) {
      if (!control || this.v < 7 || inp.brake) { this.drift = 0; this.charge = 0; }
      else if (!inp.drift) {
        if (this.charge > 1.7) this.giveBoost(1.25);
        else if (this.charge > 0.8) this.giveBoost(0.65);
        this.drift = 0; this.charge = 0;
      }
    }

    const sf = clamp(Math.abs(this.v) / 7, 0, 1) * (this.v < 0 ? -1 : 1);
    let turn;
    if (this.drift) {
      const s = steer * this.drift;
      turn = this.drift * (0.55 + 0.45 * (1 + s)) * 1.6;
      this.charge += dt * (0.7 + 0.5 * Math.max(0, s));
    } else turn = steer * 2.2 * (1 - Math.min(0.3, Math.abs(this.v) / 130));
    this.h = wrapA(this.h - turn * sf * dt);
    this.steerVis += (steer - this.steerVis) * Math.min(1, dt * 10);

    this.x += Math.sin(this.h) * this.v * dt;
    this.z += Math.cos(this.h) * this.v * dt;

    // muren
    const n = T.nearest(this.x, this.z, n0.i);
    const lim = T.halfWidth + T.verge - 1.0;
    this.bump = false;
    if (Math.abs(n.lat) > lim) {
      const s = Math.sign(n.lat), over = Math.abs(n.lat) - lim;
      this.x -= T.nx[n.i] * s * over; this.z -= T.nz[n.i] * s * over;
      let dh = wrapA(T.heading(n.i) - this.h);
      if (Math.abs(dh) > Math.PI / 2) dh = wrapA(dh + Math.PI);
      if (Math.abs(Math.sin(dh)) > 0.3 && Math.abs(this.v) > 8) { this.v *= 0.6; this.bump = true; }
      this.h = wrapA(this.h + dh * 0.35);
      this.v *= Math.pow(0.4, dt);
    }

    // voortgang (voor rondes en positie)
    let d = n.i - this.ti;
    if (d > N / 2) d -= N; else if (d < -N / 2) d += N;
    this.tot += d; this.ti = n.i;

    this.yaw += wrapA(this.h - this.drift * 0.42 - this.yaw) * Math.min(1, dt * 9);
    this.visYaw = this.yaw + this.spinAng;
  }
}

export function makeKartMesh(color) {
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
