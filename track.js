import * as THREE from 'three';

// Controlepunten van het circuit (x, z). De weg loopt hier vloeiend doorheen.
const CTRL = [
  [0, 0], [80, 0], [140, 10], [175, 50], [170, 100], [130, 120], [95, 105], [70, 130],
  [80, 170], [130, 185], [180, 200], [200, 240], [170, 275], [100, 280], [30, 270],
  [-30, 250], [-60, 210], [-40, 170], [-80, 140], [-120, 110], [-130, 60], [-100, 20], [-50, 0],
];
const SCALE = 1.15;

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export class Track {
  constructor(scene) {
    this.halfWidth = 8;   // halve wegbreedte
    this.verge = 5;       // zandstrook tot de muur
    const pts = CTRL.map(([x, z]) => new THREE.Vector3(x * SCALE, 0, z * SCALE));
    const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
    this.length = curve.getLength();
    const N = this.N = Math.round(this.length);
    this.px = new Float32Array(N); this.pz = new Float32Array(N);
    this.tx = new Float32Array(N); this.tz = new Float32Array(N);
    this.nx = new Float32Array(N); this.nz = new Float32Array(N);
    const p = new THREE.Vector3(), tg = new THREE.Vector3();
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (let i = 0; i < N; i++) {
      curve.getPointAt(i / N, p);
      curve.getTangentAt(i / N, tg);
      const l = Math.hypot(tg.x, tg.z) || 1;
      this.px[i] = p.x; this.pz[i] = p.z;
      this.tx[i] = tg.x / l; this.tz[i] = tg.z / l;
      this.nx[i] = -this.tz[i]; this.nz[i] = this.tx[i];
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    this.bounds = { minX, maxX, minZ, maxZ };

    const at = (f) => Math.round(N * f) % N;
    this.boxSpots = [];
    for (const f of [0.14, 0.46, 0.74]) for (const lat of [-5, -1.7, 1.7, 5]) this.boxSpots.push(this.pos(at(f), lat));
    this.pads = [{ i: at(0.05), lat: 0 }, { i: at(0.6), lat: 3 }, { i: at(0.88), lat: -3 }];

    this.group = new THREE.Group();
    scene.add(this.group);
    this.build();
  }

  pos(i, lat) { return [this.px[i] + this.nx[i] * lat, this.pz[i] + this.nz[i] * lat]; }
  heading(i) { return Math.atan2(this.tx[i], this.tz[i]); }

  // dichtstbijzijnde punt op de weg; lat = afstand zijwaarts vanaf het midden
  nearest(x, z, hint) {
    const N = this.N;
    let best = 0, bd = Infinity;
    if (hint < 0) {
      for (let i = 0; i < N; i++) {
        const dx = x - this.px[i], dz = z - this.pz[i], d = dx * dx + dz * dz;
        if (d < bd) { bd = d; best = i; }
      }
    } else {
      for (let k = -30; k <= 30; k++) {
        const i = (hint + k + N) % N;
        const dx = x - this.px[i], dz = z - this.pz[i], d = dx * dx + dz * dz;
        if (d < bd) { bd = d; best = i; }
      }
    }
    const dx = x - this.px[best], dz = z - this.pz[best];
    return { i: best, lat: dx * this.nx[best] + dz * this.nz[best] };
  }

  isPad(i, lat) {
    const N = this.N;
    for (const p of this.pads) {
      let d = Math.abs(i - p.i); d = Math.min(d, N - d);
      if (d <= 3 && Math.abs(lat - p.lat) < 2.3) return true;
    }
    return false;
  }

  // strook langs het hele circuit, tussen twee zijwaartse afstanden
  strip(latA, latB, yA, yB, colorFn, uvLen = 10) {
    const N = this.N;
    const pos = new Float32Array(N * 12), uv = new Float32Array(N * 8), col = new Float32Array(N * 12);
    const idx = [];
    let dist = 0;
    const c = new THREE.Color();
    for (let k = 0; k < N; k++) {
      const i = k, j = (k + 1) % N;
      const seg = Math.hypot(this.px[j] - this.px[i], this.pz[j] - this.pz[i]);
      const a0 = this.pos(i, latA), b0 = this.pos(i, latB), a1 = this.pos(j, latA), b1 = this.pos(j, latB);
      pos.set([a0[0], yA, a0[1], b0[0], yB, b0[1], a1[0], yA, a1[1], b1[0], yB, b1[1]], k * 12);
      const v0 = dist / uvLen, v1 = (dist + seg) / uvLen;
      uv.set([0, v0, 1, v0, 0, v1, 1, v1], k * 8);
      if (colorFn) { c.set(colorFn(k)); for (let q = 0; q < 4; q++) col.set([c.r, c.g, c.b], k * 12 + q * 3); }
      const o = k * 4;
      idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2);
      dist += seg;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    if (colorFn) g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  build() {
    const G = this.group, hw = this.halfWidth, vg = this.verge;
    const { minX, maxX, minZ, maxZ } = this.bounds;
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
    const W = maxX - minX + 500, H = maxZ - minZ + 500;

    // gras
    const grass = canvasTex(128, 128, (x, w, h) => {
      x.fillStyle = '#5bb04a'; x.fillRect(0, 0, w, h);
      for (let i = 0; i < 900; i++) {
        x.fillStyle = Math.random() < 0.5 ? '#4f9e40' : '#69c056';
        x.fillRect(Math.random() * w, Math.random() * h, 2, 2);
      }
    });
    grass.wrapS = grass.wrapT = THREE.RepeatWrapping;
    grass.repeat.set(W / 12, H / 12);
    const gGeo = new THREE.PlaneGeometry(W, H); gGeo.rotateX(-Math.PI / 2);
    const ground = new THREE.Mesh(gGeo, new THREE.MeshLambertMaterial({ map: grass }));
    ground.position.set(cx, 0, cz);
    G.add(ground);

    const off = (n) => ({ polygonOffset: true, polygonOffsetFactor: -n, polygonOffsetUnits: -n });

    // zandstroken
    const sandMat = new THREE.MeshLambertMaterial({ color: 0xe3c47e, side: THREE.DoubleSide, ...off(1) });
    G.add(new THREE.Mesh(this.strip(hw + 0.5, hw + vg + 0.2, 0.02, 0.02), sandMat));
    G.add(new THREE.Mesh(this.strip(-hw - vg - 0.2, -hw - 0.5, 0.02, 0.02), sandMat));

    // asfalt
    const road = canvasTex(256, 256, (x, w, h) => {
      x.fillStyle = '#4a4a52'; x.fillRect(0, 0, w, h);
      for (let i = 0; i < 2500; i++) {
        const v = 60 + Math.random() * 40 | 0;
        x.fillStyle = `rgb(${v},${v},${v + 6})`;
        x.fillRect(Math.random() * w, Math.random() * h, 2, 2);
      }
      x.fillStyle = 'rgba(255,255,255,0.85)';
      x.fillRect(w / 2 - 3, 0, 6, h / 2);
      x.fillRect(6, 0, 5, h); x.fillRect(w - 11, 0, 5, h);
    });
    road.wrapS = road.wrapT = THREE.RepeatWrapping;
    G.add(new THREE.Mesh(this.strip(-hw, hw, 0.04, 0.04, null, 14),
      new THREE.MeshLambertMaterial({ map: road, side: THREE.DoubleSide, ...off(2) })));

    // rood-witte randen
    const curbMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, ...off(3) });
    const curbCol = (k) => (Math.floor(k / 3) % 2 ? 0xffffff : 0xe8322b);
    G.add(new THREE.Mesh(this.strip(hw - 0.2, hw + 1.1, 0.06, 0.06, curbCol), curbMat));
    G.add(new THREE.Mesh(this.strip(-hw - 1.1, -hw + 0.2, 0.06, 0.06, curbCol), curbMat));

    // muren
    const wallMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    const wallCol = (k) => (Math.floor(k / 4) % 2 ? 0xffffff : 0x2f6fe8);
    G.add(new THREE.Mesh(this.strip(hw + vg, hw + vg, 0, 1.3, wallCol), wallMat));
    G.add(new THREE.Mesh(this.strip(-hw - vg, -hw - vg, 0, 1.3, wallCol), wallMat));

    // start/finish
    const checker = canvasTex(128, 32, (x, w, h) => {
      for (let i = 0; i < 16; i++) for (let j = 0; j < 4; j++) {
        x.fillStyle = (i + j) % 2 ? '#111' : '#fff';
        x.fillRect(i * 8, j * 8, 8, 8);
      }
    });
    const slGeo = new THREE.PlaneGeometry(hw * 2, 2.5); slGeo.rotateX(-Math.PI / 2);
    const sl = new THREE.Mesh(slGeo, new THREE.MeshLambertMaterial({ map: checker, ...off(4) }));
    sl.position.set(this.px[0], 0.08, this.pz[0]);
    sl.rotation.y = this.heading(0);
    G.add(sl);

    // startboog
    const arch = new THREE.Group();
    const poleMat = new THREE.MeshLambertMaterial({ color: 0x333344 });
    for (const s of [-1, 1]) {
      const pole = new THREE.Mesh(new THREE.BoxGeometry(0.8, 8, 0.8), poleMat);
      pole.position.set(s * (hw + 2.5), 4, 0); arch.add(pole);
    }
    const banner = canvasTex(512, 64, (x, w, h) => {
      x.fillStyle = '#ff5a1f'; x.fillRect(0, 0, w, h);
      x.fillStyle = '#ffd23f'; x.fillRect(0, 0, w, 6); x.fillRect(0, h - 6, w, 6);
      x.font = 'bold 44px system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillStyle = '#fff'; x.fillText('KNALKARTS', w / 2, h / 2 + 2);
    });
    const bMat = new THREE.MeshLambertMaterial({ map: banner });
    const ban = new THREE.Mesh(new THREE.BoxGeometry((hw + 2.5) * 2 + 0.8, 2, 0.4),
      [poleMat, poleMat, poleMat, poleMat, bMat, bMat]);
    ban.position.y = 7.4; arch.add(ban);
    arch.position.set(this.px[0], 0, this.pz[0]);
    arch.rotation.y = this.heading(0);
    G.add(arch);

    // boostpijlen
    this.padTex = canvasTex(64, 128, (x, w, h) => {
      x.fillStyle = '#ff8a00'; x.fillRect(0, 0, w, h);
      x.strokeStyle = '#fff36b'; x.lineWidth = 9; x.lineJoin = 'round';
      for (let k = 0; k < 2; k++) {
        const y = 25 + k * 64;
        x.beginPath(); x.moveTo(10, y); x.lineTo(w / 2, y + 26); x.lineTo(w - 10, y); x.stroke();
      }
    });
    this.padTex.wrapT = THREE.RepeatWrapping;
    const padMat = new THREE.MeshBasicMaterial({ map: this.padTex, ...off(5) });
    for (const p of this.pads) {
      const geo = new THREE.PlaneGeometry(4, 6); geo.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(geo, padMat);
      const [x, z] = this.pos(p.i, p.lat);
      m.position.set(x, 0.09, z); m.rotation.y = this.heading(p.i);
      G.add(m);
    }

    // bomen
    const trunkGeo = new THREE.CylinderGeometry(0.4, 0.6, 3, 6); trunkGeo.translate(0, 1.5, 0);
    const leafGeo = new THREE.ConeGeometry(2.6, 6, 7); leafGeo.translate(0, 5.5, 0);
    const spots = [];
    let tries = 0;
    while (spots.length < 260 && tries++ < 3000) {
      const x = minX - 80 + Math.random() * (maxX - minX + 160);
      const z = minZ - 80 + Math.random() * (maxZ - minZ + 160);
      const n = this.nearest(x, z, -1);
      const dx = x - this.px[n.i], dz = z - this.pz[n.i];
      if (Math.hypot(dx, dz) < hw + vg + 5) continue;
      spots.push([x, z, 0.7 + Math.random() * 0.8]);
    }
    const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: 0x7a4b2a }), spots.length);
    const leaves = new THREE.InstancedMesh(leafGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), spots.length);
    const d = new THREE.Object3D(), col = new THREE.Color();
    spots.forEach(([x, z, s], i) => {
      d.position.set(x, 0, z); d.scale.setScalar(s); d.rotation.y = Math.random() * 6; d.updateMatrix();
      trunks.setMatrixAt(i, d.matrix); leaves.setMatrixAt(i, d.matrix);
      leaves.setColorAt(i, col.setHSL(0.27 + Math.random() * 0.08, 0.55, 0.28 + Math.random() * 0.12));
    });
    G.add(trunks, leaves);

    // heuvels in de verte
    const hillMat = new THREE.MeshLambertMaterial({ color: 0x6fae5c });
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const r = Math.max(maxX - minX, maxZ - minZ) * 0.75 + 60;
      const hill = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), hillMat);
      hill.position.set(cx + Math.cos(a) * r, 0, cz + Math.sin(a) * r);
      hill.scale.set(60 + Math.random() * 50, 25 + Math.random() * 35, 60 + Math.random() * 50);
      G.add(hill);
    }
  }
}
