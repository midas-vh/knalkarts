import * as THREE from 'three';

// De Sterrenbaan: gemaakt in Blender (models/sterrenbaan_build.py).
// sterrenbaan.json = de middenlijn per meter (positie, rechts- en omhoog-vector, breedte, vangrails, gaten).
// sterrenbaan.glb  = alles wat je ziet (weg, wolken, sterren, poorten).
// Vooruit = (sin h, cos h) in het xz-vlak; lat > 0 = rechts van het midden.

const UNLIT = new Set(['SB_Tegel', 'SB_Neon', 'SB_Rail', 'SB_Finish', 'SB_Boost', 'SB_BoostPijl', 'SB_Poort',
  'SB_Ster', 'SB_Tekst', 'SB_Hemelster', 'SB_Maan', 'SB_PlaneetRing']);
const NO_FOG = new Set(['SB_Hemelster', 'SB_Maan', 'SB_Planeet', 'SB_PlaneetRing']);

export class Track {
  static async load(scene, url = 'models/sterrenbaan.json') {
    const data = await fetch(url).then((r) => r.json());
    const t = new Track(scene, data);
    t.ready = t.loadModel().catch((e) => console.error('Baanmodel niet geladen', e));
    return t;
  }

  constructor(scene, d) {
    const N = this.N = d.N;
    this.length = N;
    const f = () => new Float32Array(N);
    Object.assign(this, {
      px: f(), py: f(), pz: f(), tx: f(), tz: f(), nx: f(), nz: f(),
      ux: f(), uy: f(), uz: f(), hw: f(), slope: f(), bank: f(),
      rails: Uint8Array.from(d.rails), gat: Uint8Array.from(d.gat),
    });
    for (let i = 0; i < N; i++) {
      const [x, y, z] = d.p[i], [rx, ry, rz] = d.r[i], [ux, uy, uz] = d.u[i];
      this.px[i] = x; this.py[i] = y; this.pz[i] = z;
      const rl = Math.hypot(rx, rz) || 1;
      this.nx[i] = rx / rl; this.nz[i] = rz / rl;
      this.bank[i] = ry / rl;
      this.ux[i] = ux; this.uy[i] = uy; this.uz[i] = uz;
      this.hw[i] = d.hw[i];
    }
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (let i = 0; i < N; i++) {
      const a = (i + N - 1) % N, b = (i + 1) % N;
      const dx = this.px[b] - this.px[a], dz = this.pz[b] - this.pz[a], l = Math.hypot(dx, dz) || 1;
      this.tx[i] = dx / l; this.tz[i] = dz / l;
      this.slope[i] = (this.py[b] - this.py[a]) / l;
      minX = Math.min(minX, this.px[i]); maxX = Math.max(maxX, this.px[i]);
      minZ = Math.min(minZ, this.pz[i]); maxZ = Math.max(maxZ, this.pz[i]);
    }
    this.bounds = { minX, maxX, minZ, maxZ };
    this.halfWidth = 7;
    this.pads = d.boost.map((b) => ({ i: b.i, lat: b.lat }));
    this.gaps = d.schansen;

    // itemkubussen op drie rechte stukken
    this.boxSpots = [];
    for (const fr of [0.1, 0.45, 0.78]) {
      const i = Math.round(N * fr) % N;
      for (const l of [-0.62, -0.21, 0.21, 0.62]) {
        const lat = l * this.hw[i];
        const [x, z] = this.pos(i, lat);
        this.boxSpots.push([x, z, this.py[i] + this.bank[i] * lat]);
      }
    }

    this.group = new THREE.Group();
    scene.add(this.group);
  }

  async loadModel(url = 'models/sterrenbaan.glb') {
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const gltf = await new GLTFLoader().loadAsync(url);
    const mats = new Map();
    gltf.scene.traverse((o) => {
      o.matrixAutoUpdate = false; o.updateMatrix();
      if (!o.isMesh) return;
      const m = o.material, key = m.name + (o.geometry.attributes.color ? '+vc' : '');
      if (!mats.has(key)) {
        const vertexColors = !!o.geometry.attributes.color;
        const nm = UNLIT.has(m.name)
          ? new THREE.MeshBasicMaterial({ color: m.color, vertexColors })
          : new THREE.MeshLambertMaterial({
            color: m.color, vertexColors,
            emissive: m.emissive.clone().multiplyScalar(Math.min(1, m.emissiveIntensity ?? 1)),
          });
        if (NO_FOG.has(m.name)) nm.fog = false;
        mats.set(key, nm);
      }
      o.material = mats.get(key);
    });
    this.group.add(gltf.scene);
  }

  pos(i, lat) { return [this.px[i] + this.nx[i] * lat, this.pz[i] + this.nz[i] * lat]; }
  heading(i) { return Math.atan2(this.tx[i], this.tz[i]); }

  // dichtstbijzijnde punt op de middenlijn. Met y erbij kiest hij de goede laag in de spiraal.
  nearest(x, z, hint, y) {
    const N = this.N;
    let best = 0, bd = Infinity;
    const useY = y !== undefined && hint < 0;
    const from = hint < 0 ? 0 : -30, to = hint < 0 ? N - 1 : 30;
    for (let k = from; k <= to; k++) {
      const i = hint < 0 ? k : (hint + k + N) % N;
      const dx = x - this.px[i], dz = z - this.pz[i];
      let d = dx * dx + dz * dz;
      if (useY) { const dy = y - this.py[i]; d += dy * dy * 4; }
      if (d < bd) { bd = d; best = i; }
    }
    const dx = x - this.px[best], dz = z - this.pz[best];
    return { i: best, lat: dx * this.nx[best] + dz * this.nz[best], along: dx * this.tx[best] + dz * this.tz[best] };
  }

  // hoogte van het wegdek op dat punt (met helling en schuinte in de bocht)
  surfaceY(n) { return this.py[n.i] + this.slope[n.i] * n.along + this.bank[n.i] * n.lat; }
  // ligt hier weg? (niet in een schansgat, niet naast de baan)
  onRoad(n) { return !this.gat[n.i] && Math.abs(n.lat) <= this.hw[n.i] + 0.75; }
  // staat er een vangrail aan deze kant?
  railAt(i, lat) { return (this.rails[i] & (lat > 0 ? 2 : 1)) !== 0; }
  // eerste index van een gat binnen `ahead` meter vooruit, of -1
  gapAhead(i, ahead) {
    for (let k = 0; k <= ahead; k++) if (this.gat[(i + k) % this.N]) return (i + k) % this.N;
    return -1;
  }

  isPad(i, lat) {
    const N = this.N;
    for (const p of this.pads) {
      const d = (i - p.i + N) % N;
      if (d <= 6 && Math.abs(lat - p.lat) < 2.4) return true;
    }
    return false;
  }
}
