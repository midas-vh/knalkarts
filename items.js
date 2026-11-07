import * as THREE from 'three';

// ---------- de items ----------
// w = kans per positie: [vooraan, voor het midden, achter het midden, achteraan]
export const ITEMS = {
  banaan:  { icon: '🍌', naam: 'Bananenschil', w: [5, 3, 1, 0] },
  groen:   { icon: '🟢', naam: 'Stuiterbal', w: [3, 3, 2, 1] },
  schild:  { icon: '🛡️', naam: 'Bubbelschild', w: [2.5, 1.5, 1, 0.5] },
  bom:     { icon: '💣', naam: 'Knalbom', w: [1, 2.5, 1.5, 1] },
  rood:    { icon: '🎯', naam: 'Zoekraket', w: [0.3, 2.5, 3.5, 2] },
  turbo:   { icon: '🚀', naam: 'Turbo', w: [1, 2, 2, 1.5] },
  turbo3:  { icon: '🚀', naam: 'Drie turbo\'s', w: [0, 0.5, 2.5, 3.5], uses: 3 },
  komeet:  { icon: '☄️', naam: 'Komeet', w: [0, 0, 1, 4] },
};
export const ITEM_KEYS = Object.keys(ITEMS);

// trekt een item: hoe verder achteraan, hoe beter
export function rollItem(rank, total) {
  const r = total > 1 ? (rank - 1) / (total - 1) : 0.5;
  const tier = r < 0.2 ? 0 : r < 0.5 ? 1 : r < 0.8 ? 2 : 3;
  let sum = 0;
  for (const k of ITEM_KEYS) sum += ITEMS[k].w[tier];
  let x = Math.random() * sum;
  for (const k of ITEM_KEYS) { x -= ITEMS[k].w[tier]; if (x <= 0) return k; }
  return 'turbo';
}

export function itemIcon(item, uses) {
  if (!item) return '';
  const d = ITEMS[item];
  if (!d) return '';
  return d.uses ? `${d.icon}<small>×${uses ?? d.uses}</small>` : d.icon;
}

// ---------- 3D-ontwerpen (eigen RacePlanet-stijl) ----------
const lam = (color, emissive = 0) => new THREE.MeshLambertMaterial({ color, emissive });
const basic = (color, opts = {}) => new THREE.MeshBasicMaterial({ color, ...opts });
const M = {
  geel: lam(0xffd84a, 0x3a2a00), geelDonker: lam(0xe0a800), bruin: lam(0x5a3a1a),
  groen: lam(0x2ec27e, 0x0a3a20), wit: lam(0xffffff, 0x222222),
  rood: lam(0xe8322b, 0x400a08), roodDonker: lam(0x8e1a14), oog: basic(0x5ff3ff),
  zwart: lam(0x26262e), oranje: lam(0xff7f11, 0x3a1a00), vonk: basic(0xfff36b),
  vlam: basic(0xffa31a, { transparent: true, opacity: 0.9 }),
};
const mesh = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); return m; };

// 🍌 bananenschil: gebogen vrucht met drie omgekrulde schillen
export function makeBanana() {
  const g = new THREE.Group();
  // kort stukje banaan in het midden met een bruin steeltje
  g.add(mesh(new THREE.CapsuleGeometry(0.2, 0.3, 6, 10), M.geel, 0, 0.42, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.05, 0.08, 0.2, 6), M.bruin, 0, 0.78, 0));
  // vier schillen die vanaf de top naar de grond hangen
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + 0.3, ca = Math.cos(a), sa = Math.sin(a);
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(ca * 0.12, 0.62, sa * 0.12),
      new THREE.Vector3(ca * 0.42, 0.55, sa * 0.42),
      new THREE.Vector3(ca * 0.68, 0.25, sa * 0.68),
      new THREE.Vector3(ca * 0.8, 0.05, sa * 0.8),
    ]);
    const flap = mesh(new THREE.TubeGeometry(curve, 12, 0.12, 6, false), i % 2 ? M.geel : M.geelDonker);
    g.add(flap);
    g.add(mesh(new THREE.SphereGeometry(0.1, 8, 6), M.bruin, ca * 0.8, 0.06, sa * 0.8));
  }
  g.scale.setScalar(1.5);
  return g;
}

// 🟢 stuiterbal: groene bal met een witte band en twee knalogen
export function makeGreenBall() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.SphereGeometry(0.75, 18, 12), M.groen));
  const band = mesh(new THREE.TorusGeometry(0.76, 0.09, 8, 24), M.wit);
  band.rotation.x = Math.PI / 2; g.add(band);
  for (const s of [-1, 1]) g.add(mesh(new THREE.SphereGeometry(0.14, 10, 8), M.wit, s * 0.24, 0.32, 0.64));
  return g;
}

// 🎯 zoekraket: kleine rode raket met vinnen en een lichtblauw zoekoog
export function makeHomingRocket() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.32, 0.32, 1.3, 12).rotateX(Math.PI / 2), M.rood));
  g.add(mesh(new THREE.ConeGeometry(0.32, 0.6, 12).rotateX(Math.PI / 2), M.wit, 0, 0, 0.95));
  g.add(mesh(new THREE.SphereGeometry(0.13, 10, 8), M.oog, 0, 0.2, 0.75));
  for (let i = 0; i < 4; i++) {
    const fin = mesh(new THREE.BoxGeometry(0.06, 0.45, 0.45), M.roodDonker, 0, 0, -0.5);
    fin.rotation.z = i * Math.PI / 2; fin.translateY(0.38); g.add(fin);
  }
  const flame = mesh(new THREE.ConeGeometry(0.24, 0.9, 8).rotateX(-Math.PI / 2), M.vlam, 0, 0, -1.1);
  g.add(flame); g.userData.flame = flame;
  return g;
}

// 💣 knalbom: zwarte bom met oranje band en sputterend lontje
export function makeBomb() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.SphereGeometry(0.62, 16, 12), M.zwart));
  const band = mesh(new THREE.TorusGeometry(0.62, 0.08, 8, 24), M.oranje);
  band.rotation.x = Math.PI / 2; g.add(band);
  g.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.35, 6), M.bruin, 0, 0.75, 0));
  const spark = mesh(new THREE.OctahedronGeometry(0.16), M.vonk, 0, 0.98, 0);
  g.add(spark); g.userData.spark = spark;
  return g;
}

// 💥 explosie: witte flits, vuurbal in twee lagen, schokgolf, rondvliegende brokjes en rook
const X = {
  bol: new THREE.IcosahedronGeometry(1, 2),
  ring: new THREE.RingGeometry(0.75, 1, 48).rotateX(-Math.PI / 2),
  brok: new THREE.TetrahedronGeometry(0.35),
};
const glow = (color, opacity) => basic(color, { transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending });
const BROK_KLEUR = [0xffd23f, 0xff8a1f, 0xff4d1a, 0xfff3b0];
const easeOut = (t) => 1 - (1 - t) * (1 - t);
export class Explosion {
  constructor(size) {
    this.size = size; this.t = 0;
    const g = this.group = new THREE.Group();
    const add = (m) => { g.add(m); return m; };
    this.flash = add(new THREE.Mesh(X.bol, glow(0xffffff, 1)));
    this.fire = add(new THREE.Mesh(X.bol, glow(0xffb02e, 0.95)));
    this.fire2 = add(new THREE.Mesh(X.bol, glow(0xff4d1a, 0.75)));
    this.smoke = add(new THREE.Mesh(X.bol, basic(0x4a4268, { transparent: true, opacity: 0, depthWrite: false })));
    this.ring = add(new THREE.Mesh(X.ring, glow(0xffd27a, 0.9)));
    this.ring.position.y = 0.3;
    // losse vuurwolkjes maken de vuurbal bollig, rookwolkjes stijgen daarna op
    const dir = () => new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).normalize();
    this.puffs = [];
    for (let i = 0; i < 7; i++) {
      const p = add(new THREE.Mesh(X.bol, glow(i % 2 ? 0xffc24a : 0xff6a1f, 0.85)));
      p.userData.d = dir().multiplyScalar(size * (0.45 + Math.random() * 0.25));
      p.userData.s = 0.4 + Math.random() * 0.25;
      this.puffs.push(p);
    }
    this.smokes = [];
    for (let i = 0; i < 5; i++) {
      const p = add(new THREE.Mesh(X.bol, basic(0x6c6494, { transparent: true, opacity: 0, depthWrite: false })));
      p.userData.d = dir().multiplyScalar(size * 0.4);
      p.userData.s = 0.35 + Math.random() * 0.2;
      this.smokes.push(p);
    }
    this.bits = [];
    const n = Math.round(14 + size * 2);
    for (let i = 0; i < n; i++) {
      const b = add(new THREE.Mesh(X.brok, glow(BROK_KLEUR[i % 4], 1)));
      const a = Math.random() * Math.PI * 2, up = 0.3 + Math.random() * 0.9, sp = (6 + Math.random() * 10) * (0.5 + size / 8);
      b.userData.v = new THREE.Vector3(Math.cos(a) * sp, up * sp * 1.2, Math.sin(a) * sp);
      b.userData.r = new THREE.Vector3(Math.random() * 10, Math.random() * 10, 0);
      b.scale.setScalar(0.6 + Math.random() * 0.9 * (size / 5));
      this.bits.push(b);
    }
    this.update(0);
  }
  // geeft false terug als hij klaar is
  update(dt) {
    const t = (this.t += dt), s = this.size;
    const fade = (m, op, t0, t1) => { const f = clamp01((t - t0) / (t1 - t0)); m.material.opacity = op * (1 - f); m.visible = f < 1; };
    this.flash.scale.setScalar(s * 0.5 * (1 + t * 10)); fade(this.flash, 1, 0, 0.12);
    this.fire.scale.setScalar(s * (0.25 + 0.6 * easeOut(clamp01(t / 0.3)))); fade(this.fire, 0.95, 0.25, 0.8);
    this.fire2.scale.setScalar(s * (0.35 + 0.7 * easeOut(clamp01(t / 0.4)))); fade(this.fire2, 0.7, 0.3, 0.9);
    this.ring.scale.setScalar(s * (0.3 + 2.4 * easeOut(clamp01(t / 0.5)))); fade(this.ring, 0.9, 0.1, 0.55);
    const grow = easeOut(clamp01(t / 0.35));
    for (const p of this.puffs) {
      p.position.copy(p.userData.d).multiplyScalar(grow);
      p.position.y += t * s * 0.25;
      p.scale.setScalar(s * p.userData.s * (0.3 + 0.7 * grow));
      fade(p, 0.85, 0.3, 0.85);
    }
    this.smoke.visible = false;
    for (const p of this.smokes) {
      p.position.copy(p.userData.d).multiplyScalar(0.6 + t);
      p.position.y += t * s * 0.6;
      p.scale.setScalar(s * p.userData.s * (0.6 + t * 0.9));
      p.material.opacity = 0.6 * Math.sin(Math.PI * clamp01((t - 0.25) / 1.0));
    }
    for (const b of this.bits) {
      const v = b.userData.v;
      v.y -= 22 * dt;
      b.position.addScaledVector(v, dt);
      b.rotation.x += b.userData.r.x * dt; b.rotation.y += b.userData.r.y * dt;
      fade(b, 1, 0.35, 0.95);
    }
    return t < 1.25;
  }
}
const clamp01 = (x) => Math.max(0, Math.min(1, x));

// ☄️ komeet: gloeiende kop en een staart achter de kart
export function makeComet() {
  const g = new THREE.Group();
  const add = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };
  g.add(mesh(new THREE.SphereGeometry(2.1, 20, 14), basic(0xffb347, { ...add, opacity: 0.45 }), 0, 0.9, 0.4));
  g.add(mesh(new THREE.SphereGeometry(1.4, 16, 12), basic(0xfff1a8, { ...add, opacity: 0.35 }), 0, 0.9, 0.9));
  const tail = mesh(new THREE.ConeGeometry(2.0, 8, 16, 1, true).rotateX(-Math.PI / 2),
    basic(0xff6a1f, { ...add, opacity: 0.35, side: THREE.DoubleSide }), 0, 0.9, -4.2);
  g.add(tail); g.userData.tail = tail;
  return g;
}

// 🛡️ bubbelschild
export function makeShield() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.SphereGeometry(2.1, 20, 14),
    basic(0x6fe7ff, { transparent: true, opacity: 0.18, depthWrite: false }), 0, 0.8, 0));
  g.add(mesh(new THREE.IcosahedronGeometry(2.15, 1),
    basic(0xbff6ff, { wireframe: true, transparent: true, opacity: 0.5 }), 0, 0.8, 0));
  return g;
}
