# Bouwt de Sterrenbaan in Blender (scene "Sterrenbaan") en schrijft sterrenbaan.json voor het spel.
# Draaien in Blender:  exec(open(r"...\models\sterrenbaan_build.py").read())
# Blender-assen: Z omhoog. In het spel (three.js): x = x, y = z, z = -y.
import bpy, bmesh, math, random, json, os, colorsys
from mathutils import Vector, Matrix, kdtree

DIR = globals().get('SB_DIR') or os.path.dirname(bpy.data.filepath)
random.seed(7)

# ------------------------------------------------------------------ baanlijn
# (x, y, z, halve breedte, vangrail 'L'/'R'/'B'/'', gat 0/1)  - gat: vanaf dit punt tot het volgende ligt geen weg
CP = []
def cp(x, y, z, hw=7, rails='', gap=0): CP.append((x, y, z, hw, rails, gap))

cp(-60, 0, 25, 8, 'B'); cp(0, 0, 26, 8, 'B'); cp(70, 0, 27, 8)                     # start/finish
cp(130, 10, 34); cp(175, 45, 44); cp(185, 100, 52); cp(170, 160, 50, 7, 'R')       # grote heuvel
for k in range(11):                                                                # dalende spiraal
    a = math.radians(45 * k)
    cp(90 + 38 * math.cos(a), 230 + 38 * math.sin(a), 48 - 2.2 * k, 7, 'R')
cp(60, 300, 25); cp(20, 315, 25); cp(-20, 318, 25); cp(-38, 318, 26.5)             # aanloop schans 1
cp(-47, 318, 28, 7, '', 1); cp(-60, 317, 29, 7, '', 1); cp(-74, 316, 25)            # schans 1 + landing
cp(-110, 300, 22, 6); cp(-150, 270, 24, 6); cp(-158, 225, 30, 5.5)                  # smalle S-bochten
cp(-128, 188, 25, 5.5); cp(-150, 148, 20, 5.5, 'R'); cp(-192, 118, 18, 6, 'R')
cp(-205, 70, 22, 6); cp(-180, 28, 26); cp(-140, 8, 19); cp(-118, 3, 21)            # golf naar schans 2
cp(-108, 1, 22.5, 7, '', 1); cp(-97, 0, 23.2, 7, '', 1); cp(-84, 0, 21.5, 8)        # schans 2 + landing

def catmull(p0, p1, p2, p3, t, alpha=0.5):
    def tj(ti, a, b): return ti + max((b - a).length, 1e-4) ** alpha
    t0 = 0; t1 = tj(t0, p0, p1); t2 = tj(t1, p1, p2); t3 = tj(t2, p2, p3)
    tt = t1 + (t2 - t1) * t
    a1 = p0 * ((t1 - tt) / (t1 - t0)) + p1 * ((tt - t0) / (t1 - t0))
    a2 = p1 * ((t2 - tt) / (t2 - t1)) + p2 * ((tt - t1) / (t2 - t1))
    a3 = p2 * ((t3 - tt) / (t3 - t2)) + p3 * ((tt - t2) / (t3 - t2))
    b1 = a1 * ((t2 - tt) / (t2 - t0)) + a2 * ((tt - t0) / (t2 - t0))
    b2 = a2 * ((t3 - tt) / (t3 - t1)) + a3 * ((tt - t1) / (t3 - t1))
    return b1 * ((t2 - tt) / (t2 - t1)) + b2 * ((tt - t1) / (t2 - t1))

def sample_track():
    n = len(CP); V = [Vector(c[:3]) for c in CP]
    dense = []  # (punt, segment, t)
    for i in range(n):
        for q in range(60):
            t = q / 60
            dense.append((catmull(V[i - 1], V[i], V[(i + 1) % n], V[(i + 2) % n], t), i, t))
    cum = [0.0]
    for a, b in zip(dense, dense[1:] + dense[:1]): cum.append(cum[-1] + (b[0] - a[0]).length)
    L = cum[-1]; N = round(L)
    out = []; j = 0
    for k in range(N):
        s = k * L / N
        while cum[j + 1] < s: j += 1
        f = (s - cum[j]) / max(cum[j + 1] - cum[j], 1e-6)
        pa, seg, t = dense[j]; pb = dense[(j + 1) % len(dense)][0]
        sm = t * t * (3 - 2 * t)
        hw = CP[seg][3] + (CP[(seg + 1) % n][3] - CP[seg][3]) * sm
        out.append((pa.lerp(pb, f), hw, CP[seg][4], CP[seg][5]))
    # start/finish op index 0
    st = min(range(N), key=lambda k: (out[k][0] - Vector((0, 0, 26))).length)
    return out[st:] + out[:st]

S = sample_track(); N = len(S)
PS = [s[0] for s in S]; HWS = [s[1] for s in S]; RAILS = [s[2] for s in S]; GAP = [s[3] for s in S]
SEG_OK = [not g for g in GAP]
TS = [(PS[(k + 1) % N] - PS[k - 1]).normalized() for k in range(N)]
head = [math.atan2(t.y, t.x) for t in TS]
def wrap(a): return (a + math.pi) % (2 * math.pi) - math.pi
kap = [wrap(head[(k + 1) % N] - head[k - 1]) / 2 for k in range(N)]
kap = [sum(kap[(k + d) % N] for d in range(-12, 13)) / 25 for k in range(N)]
RS, US, BANK = [], [], []
Z = Vector((0, 0, 1))
for k in range(N):
    T = TS[k]; r0 = T.cross(Z).normalized(); u0 = r0.cross(T).normalized()
    b = max(-16, min(16, kap[k] * 700)) * (0 if GAP[k] else 1)
    br = math.radians(b); R = (r0 * math.cos(br) + u0 * math.sin(br)).normalized()
    RS.append(R); US.append(R.cross(T).normalized()); BANK.append(b)

def frame(s):
    s %= N; i = int(math.floor(s)); f = s - i; j = (i + 1) % N
    return (PS[i].lerp(PS[j], f), RS[i].lerp(RS[j], f).normalized(),
            US[i].lerp(US[j], f).normalized(), TS[i].lerp(TS[j], f).normalized())
def hwat(s):
    s %= N; i = int(math.floor(s)); f = s - i
    return HWS[i] + (HWS[(i + 1) % N] - HWS[i]) * f
def pt(s, lat, lift=0.0):
    P, R, U, T = frame(s); return P + R * lat + U * lift

# ------------------------------------------------------------------ scene, collecties, materialen
sc = bpy.data.scenes.get("Sterrenbaan") or bpy.data.scenes.new("Sterrenbaan")
bpy.context.window_manager.windows[0].scene = sc

def purge_collection(c):
    for ch in list(c.children): purge_collection(ch)
    for o in list(c.objects): bpy.data.objects.remove(o, do_unlink=True)
    bpy.data.collections.remove(c)
for c in list(sc.collection.children):
    if c.name.startswith("SB_"): purge_collection(c)
for o in list(sc.collection.objects):
    if o.name.startswith("SB_"): bpy.data.objects.remove(o, do_unlink=True)
for me in list(bpy.data.meshes):
    if me.users == 0: bpy.data.meshes.remove(me)

def coll(name):
    c = bpy.data.collections.new(name); sc.collection.children.link(c); return c
C_BAAN, C_DECOR, C_WOLK, C_LUCHT, C_TAK = (coll(n) for n in
    ("SB_Baan", "SB_Decor", "SB_Wolken", "SB_Lucht", "SB_Takeltje"))

def srgb(h):
    h = h.lstrip('#'); out = []
    for i in (0, 2, 4):
        c = int(h[i:i + 2], 16) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return (*out, 1.0)

def mat(name, hexc, rough=0.5, metal=0.0, emit=0.0, vcol=False):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree; b = nt.nodes.get("Principled BSDF")
    for n in list(nt.nodes):
        if n.type == 'VERTEX_COLOR': nt.nodes.remove(n)
    b.inputs["Base Color"].default_value = srgb(hexc)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    b.inputs["Emission Color"].default_value = srgb(hexc)
    b.inputs["Emission Strength"].default_value = emit
    if vcol:
        vc = nt.nodes.new("ShaderNodeVertexColor"); vc.layer_name = "Col"
        nt.links.new(vc.outputs["Color"], b.inputs["Base Color"])
        nt.links.new(vc.outputs["Color"], b.inputs["Emission Color"])
    m.diffuse_color = srgb(hexc)
    return m

M = dict(
    tegel=mat("SB_Tegel", "#ffffff", 0.25, 0, 0.45, vcol=True),
    voeg=mat("SB_Voeg", "#1c1838", 0.6),
    onder=mat("SB_Onderkant", "#2d2560", 0.5, 0, 0.15),
    neon=mat("SB_Neon", "#bff4ff", 0.2, 0, 3.0),
    rail=mat("SB_Rail", "#ff6ad5", 0.3, 0, 2.5),
    paal=mat("SB_Paal", "#3b3466", 0.4, 0.5),
    finish=mat("SB_Finish", "#ffffff", 0.4, 0, 0.3, vcol=True),
    boost=mat("SB_Boost", "#ff8a00", 0.3, 0, 1.2),
    pijl=mat("SB_BoostPijl", "#fff36b", 0.3, 0, 2.0),
    poort=mat("SB_Poort", "#c7a6ff", 0.3, 0.2, 1.6),
    ster=mat("SB_Ster", "#fff7d6", 0.3, 0, 2.5),
    banner=mat("SB_Banner", "#ff5a1f", 0.5, 0, 0.4),
    tekst=mat("SB_Tekst", "#ffffff", 0.4, 0, 1.5),
    wolk=mat("SB_Wolk", "#dce4ff", 1.0, 0, 0.45),
    wolk_lila=mat("SB_Wolk_Lila", "#ead9ff", 1.0, 0, 0.45),
    hemelster=mat("SB_Hemelster", "#ffffff", 0.5, 0, 4.0),
    planeet=mat("SB_Planeet", "#b46bff", 0.6, 0, 0.35),
    ring=mat("SB_PlaneetRing", "#ffc6f0", 0.6, 0, 0.5),
    maan=mat("SB_Maan", "#fff3c4", 0.6, 0, 1.4),
    t_geel=mat("SB_Tak_Geel", "#ffcf3a", 0.4, 0, 0.35),
    t_vizier=mat("SB_Tak_Vizier", "#1b1f3a", 0.1),
    t_oog=mat("SB_Tak_Oog", "#5ff3ff", 0.2, 0, 3.0),
    t_rood=mat("SB_Tak_Rood", "#e8322b", 0.4),
    t_wit=mat("SB_Tak_Wit", "#f4f4f8", 0.4),
    t_oranje=mat("SB_Tak_Oranje", "#ff7f11", 0.4),
    t_donker=mat("SB_Tak_Donker", "#26262e", 0.5, 0.3),
    t_metaal=mat("SB_Tak_Metaal", "#c8ccd4", 0.3, 0.8),
    t_touw=mat("SB_Tak_Touw", "#e8e2d0", 0.8),
)

# ------------------------------------------------------------------ mesh-hulp
def newell(pts):
    n = Vector((0, 0, 0))
    for a, b in zip(pts, pts[1:] + pts[:1]):
        n.x += (a.y - b.y) * (a.z + b.z); n.y += (a.z - b.z) * (a.x + b.x); n.z += (a.x - b.x) * (a.y + b.y)
    return n

class MB:
    def __init__(self): self.v = []; self.f = []; self.fc = []
    def poly(self, pts, col=None, up=None):
        if up is not None and newell(pts).dot(up) < 0: pts = pts[::-1]
        b = len(self.v); self.v.extend(pts); self.f.append(tuple(range(b, b + len(pts)))); self.fc.append(col)
    def vert(self, p): self.v.append(p); return len(self.v) - 1
    def face(self, idx, col=None): self.f.append(tuple(idx)); self.fc.append(col)
    def box(self, c, X, Y, Zv, sx, sy, sz):
        b = len(self.v)
        for dz in (-1, 1):
            for dy, dx in ((-1, -1), (-1, 1), (1, 1), (1, -1)):
                self.v.append(c + X * (dx * sx / 2) + Y * (dy * sy / 2) + Zv * (dz * sz / 2))
        for f in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
            self.face([b + i for i in f])
    def obj(self, name, m, c, smooth=False, recalc=False, parent=None):
        me = bpy.data.meshes.new(name)
        me.from_pydata([tuple(p) for p in self.v], [], self.f)
        if any(self.fc):
            at = me.color_attributes.new("Col", 'BYTE_COLOR', 'CORNER')
            for poly in me.polygons:
                col = self.fc[poly.index] or (1, 1, 1, 1)
                for li in poly.loop_indices: at.data[li].color_srgb = col
        if recalc or smooth:
            bm = bmesh.new(); bm.from_mesh(me)
            bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5) if smooth else None
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
            for f in bm.faces: f.smooth = smooth
            bm.to_mesh(me); bm.free()
        me.update()
        me.materials.append(m)
        ob = bpy.data.objects.new(name, me); c.objects.link(ob)
        if parent: ob.parent = parent
        return ob

def bm_obj(name, bm, m, c, smooth=False, parent=None, loc=(0, 0, 0)):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces: f.smooth = smooth
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free(); me.materials.append(m)
    ob = bpy.data.objects.new(name, me); c.objects.link(ob); ob.parent = parent; ob.location = loc
    return ob

def sides(r): return {'L': (-1,), 'R': (1,), 'B': (-1, 1)}.get(r, ())

# ------------------------------------------------------------------ de weg
# onderkant (dikke plaat) met doorgaande doorsnedes; doppen waar een gat begint/eindigt
mb = MB(); ring = []
for k in range(N):
    hw = HWS[k]
    ring.append([mb.vert(pt(k, -(hw + 0.7))), mb.vert(pt(k, hw + 0.7)),
                 mb.vert(pt(k, hw + 0.25, -0.9)), mb.vert(pt(k, -(hw + 0.25), -0.9))])
for k in range(N):
    if not SEG_OK[k]: continue
    a, b = ring[k], ring[(k + 1) % N]
    for i in range(4):
        j = (i + 1) % 4; mb.face((a[i], b[i], b[j], a[j]))
    if not SEG_OK[k - 1]: mb.face(a)
    if not SEG_OK[(k + 1) % N]: mb.face(b[::-1])
ob = mb.obj("SB_Weg_Onderkant", M['onder'], C_BAAN, recalc=True)
bm = bmesh.new(); bm.from_mesh(ob.data)
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
bm.to_mesh(ob.data); bm.free()
ob.data.materials.append(M['voeg'])
for p in ob.data.polygons:  # bovenvlak = donkere voegen
    if p.normal.dot(US[0]) > -2 and abs(p.center.z) >= 0:
        pass

# voegen-bovenvlak apart (donker), net onder de tegels
mb = MB()
for k in range(N):
    if not SEG_OK[k]: continue
    hw0, hw1 = HWS[k], HWS[(k + 1) % N]
    mb.poly([pt(k, -(hw0 + 0.7), 0.01), pt(k, hw0 + 0.7, 0.01), pt(k + 1, hw1 + 0.7, 0.01), pt(k + 1, -(hw1 + 0.7), 0.01)], up=US[k])
mb.obj("SB_Weg_Voegen", M['voeg'], C_BAAN)

# regenboogtegels: 7 kolommen, rijen van 3 m
COLS, ROW, G = 7, 3, 0.1
mb = MB()
for r in range(N // ROW):
    s0, s1 = r * ROW, min(r * ROW + ROW, N)
    if not all(SEG_OK[k % N] for k in range(s0, s1)): continue
    for c in range(COLS):
        hue = (c / COLS * 0.82 + r * 0.007 + random.uniform(-0.015, 0.015)) % 1
        rgb = colorsys.hsv_to_rgb(hue, random.uniform(0.42, 0.58), 1.0)
        def lat(s, cc, inset):
            hw = hwat(s); return -hw + 2 * hw * cc / COLS + inset
        a0, a1 = s0 + G, s1 - G
        mb.poly([pt(a0, lat(a0, c, G), 0.05), pt(a0, lat(a0, c + 1, -G), 0.05),
                 pt(a1, lat(a1, c + 1, -G), 0.05), pt(a1, lat(a1, c, G), 0.05)], col=(*rgb, 1), up=US[s0 % N])
mb.obj("SB_Weg_Tegels", M['tegel'], C_BAAN)

# lichtgevende randen
mb = MB()
for k in range(N):
    if not SEG_OK[k]: continue
    for sd in (-1, 1):
        h0, h1 = HWS[k], HWS[(k + 1) % N]
        mb.poly([pt(k, sd * (h0 + 0.1), 0.06), pt(k, sd * (h0 + 0.6), 0.06),
                 pt(k + 1, sd * (h1 + 0.6), 0.06), pt(k + 1, sd * (h1 + 0.1), 0.06)], up=US[k])
mb.obj("SB_Weg_Neonrand", M['neon'], C_BAAN)

# vangrails: palen + twee lichtgevende liggers
mbp, mbr = MB(), MB()
for k in range(N):
    if not SEG_OK[k]: continue
    for sd in sides(RAILS[k]):
        P, R, U, T = frame(k)
        if k % 4 == 0: mbp.box(pt(k, sd * (HWS[k] + 0.4), 0.65), R, T, U, 0.18, 0.18, 1.3)
        for lift in (0.55, 1.2):
            q = [pt(k, sd * (HWS[k] + 0.4), lift), pt(k + 1.02, sd * (HWS[(k + 1) % N] + 0.4), lift)]
            mbr.box((q[0] + q[1]) / 2, R, (q[1] - q[0]).normalized(), U, 0.12, (q[1] - q[0]).length, 0.12)
mbp.obj("SB_Rail_Palen", M['paal'], C_BAAN, recalc=True)
mbr.obj("SB_Rail_Liggers", M['rail'], C_BAAN, recalc=True)

# start/finish: dambord
mb = MB(); cells = 16
for row in range(2):
    for c in range(cells):
        s0, s1 = row * 1.0, row * 1.0 + 1.0; hw = HWS[0]
        l0, l1 = -hw + 2 * hw * c / cells, -hw + 2 * hw * (c + 1) / cells
        col = (1, 1, 1, 1) if (row + c) % 2 else (0.07, 0.07, 0.09, 1)
        mb.poly([pt(s0, l0, 0.08), pt(s0, l1, 0.08), pt(s1, l1, 0.08), pt(s1, l0, 0.08)], col=col, up=US[0])
mb.obj("SB_Finish", M['finish'], C_DECOR)

# ------------------------------------------------------------------ decor
gaps = [k for k in range(N) if GAP[k] and not GAP[k - 1]]           # eerste index van elk gat (de schans-rand)
landings = [k for k in range(N) if not GAP[k] and GAP[k - 1]]
def nearest_idx(x, y, z): return min(range(N), key=lambda k: (PS[k] - Vector((x, y, z))).length)
PADS = [(gaps[0] - 26, 0.0), (gaps[1] - 22, 0.0), (nearest_idx(130, 10, 34), 3.0), (nearest_idx(-150, 270, 24), -2.0)]
PADS = [((s + N) % N, l) for s, l in PADS]

mbb, mba = MB(), MB()
for s, l in PADS:
    U = US[s]
    mbb.poly([pt(s, l - 2.2, 0.07), pt(s, l + 2.2, 0.07), pt(s + 6, l + 2.2, 0.07), pt(s + 6, l - 2.2, 0.07)], up=U)
    for d in (0.6, 3.2):
        ch = [(0, -1.7), (0.9, -1.7), (2.0, 0), (0.9, 1.7), (0, 1.7), (1.1, 0)]
        mba.poly([pt(s + d + ds, l + la, 0.09) for ds, la in ch], up=U)
# geel-zwarte waarschuwingsrand op de rand van elke schans
mbw = MB()
for g0 in gaps:
    hw = HWS[g0 - 1]; n = 12
    for c in range(n):
        l0, l1 = -hw + 2 * hw * c / n, -hw + 2 * hw * (c + 1) / n
        col = (1.0, 0.82, 0.1, 1) if c % 2 else (0.08, 0.08, 0.1, 1)
        mbw.poly([pt(g0 - 1.6, l0, 0.08), pt(g0 - 1.6, l1, 0.08), pt(g0 - 0.2, l1, 0.08), pt(g0 - 0.2, l0, 0.08)], col=col, up=US[g0 - 1])
mbw.obj("SB_Schansrand", M['finish'], C_DECOR)
mbb.obj("SB_Boostplaat", M['boost'], C_DECOR)
mba.obj("SB_Boostpijlen", M['pijl'], C_DECOR)

def star_mesh(mb, c, X, Y, Zv, size, depth=0.3):
    outline = []
    for i in range(10):
        a = math.pi / 2 + i * math.pi / 5; r = size if i % 2 == 0 else size * 0.45
        outline.append(c + X * (math.cos(a) * r) + Y * (math.sin(a) * r))
    f = [mb.vert(p + Zv * depth / 2) for p in outline]; bk = [mb.vert(p - Zv * depth / 2) for p in outline]
    cf, cb = mb.vert(c + Zv * depth / 2), mb.vert(c - Zv * depth / 2)
    for i in range(10):
        j = (i + 1) % 10
        mb.face((cf, f[i], f[j])); mb.face((cb, bk[j], bk[i])); mb.face((f[i], bk[i], bk[j], f[j]))

# sterrenpoorten: ringen waar je doorheen rijdt
HOOPS = [nearest_idx(185, 100, 52), nearest_idx(-158, 225, 30), nearest_idx(-180, 28, 26), nearest_idx(20, 315, 25)]
mbh, mbs = MB(), MB()
for s in HOOPS:
    P, R, U, T = frame(s); C = P + U * 1.5; Rm = HWS[s] + 4.0; segs, tube = 56, 8
    rings = []
    for i in range(segs):
        a = 2 * math.pi * i / segs; rad = R * math.cos(a) + U * math.sin(a)
        rings.append([mbh.vert(C + rad * (Rm + 0.35 * math.cos(2 * math.pi * j / tube)) + T * (0.35 * math.sin(2 * math.pi * j / tube))) for j in range(tube)])
    for i in range(segs):
        a, b = rings[i], rings[(i + 1) % segs]
        for j in range(tube):
            jj = (j + 1) % tube; mbh.face((a[j], b[j], b[jj], a[jj]))
    for i in range(7):
        a = math.pi / 2 + 2 * math.pi * i / 7
        star_mesh(mbs, C + (R * math.cos(a) + U * math.sin(a)) * Rm, R, U, T, 1.3 if i else 2.0)
mbh.obj("SB_Sterrenpoorten", M['poort'], C_DECOR, recalc=True)
mbs.obj("SB_Poortsterren", M['ster'], C_DECOR, recalc=True)

# startboog met tekst
P, R, U, T = frame(0); hw = HWS[0] + 2.2
mbg = MB()
for sd in (-1, 1): mbg.box(P + R * (sd * hw) + U * 5.4, R, T, U, 1.2, 1.2, 10.8)
mbg.obj("SB_Startboog_Palen", M['paal'], C_DECOR, recalc=True)
mbg = MB(); mbg.box(P + U * 9.5, R, T, U, 2 * hw + 1.2, 0.6, 2.6); mbg.obj("SB_Startboog_Banner", M['banner'], C_DECOR, recalc=True)
mbg = MB(); star_mesh(mbg, P + U * 12.6, R, U, T, 1.8, 0.5); mbg.obj("SB_Startboog_Ster", M['ster'], C_DECOR, recalc=True)
try:
    cu = bpy.data.curves.new("SB_TekstCurve", 'FONT'); cu.body = "RACEPLANET"
    cu.align_x = 'CENTER'; cu.align_y = 'CENTER'; cu.size = 2.0; cu.extrude = 0.06
    tob = bpy.data.objects.new("SB_TmpTekst", cu); C_DECOR.objects.link(tob)
    dg = bpy.context.evaluated_depsgraph_get(); dg.update()
    me = bpy.data.meshes.new_from_object(tob.evaluated_get(dg))
    bpy.data.objects.remove(tob); bpy.data.curves.remove(cu)
    me.name = "SB_Startboog_Tekst"; me.materials.clear(); me.materials.append(M['tekst'])
    for sd in (-1, 1):  # voor- en achterkant van de banner
        X, Zn = (R, -T) if sd < 0 else (-R, T)
        o = bpy.data.objects.new("SB_Startboog_Tekst" + ("_Voor" if sd < 0 else "_Achter"), me); C_DECOR.objects.link(o)
        p = P + U * 9.5 + Zn * 0.31
        o.matrix_world = Matrix(((X.x, U.x, Zn.x, p.x), (X.y, U.y, Zn.y, p.y), (X.z, U.z, Zn.z, p.z), (0, 0, 0, 1)))
    text_ok = True
except Exception as e:
    text_ok = repr(e)

# ------------------------------------------------------------------ wolken
kd = kdtree.KDTree(N)
for k, p in enumerate(PS): kd.insert(p, k)
kd.balance()
def clear(c, r):  # wolk mag de weg niet raken
    p, k, d = kd.find(c); return d - r > HWS[k] + 5

def cloud(name, center, scale, n):
    bm = bmesh.new(); placed = 0
    for _ in range(n * 3):
        if placed >= n: break
        off = Vector((random.uniform(-12, 12), random.uniform(-12, 12), random.uniform(-3, 4))) * scale
        r = random.uniform(5, 11) * scale; c = center + off
        if not clear(c, r): continue
        bmesh.ops.create_icosphere(bm, subdivisions=2, radius=r,
                                   matrix=Matrix.Translation(c) @ Matrix.Diagonal((1, 1, 0.72, 1)))
        placed += 1
    if placed == 0: bm.free(); return None
    return bm_obj(name, bm, M['wolk_lila'] if random.random() < 0.35 else M['wolk'], C_WOLK, smooth=True)

ci = 0
for _ in range(46):  # wolken langs en onder de weg
    k = random.randrange(N); P, R, U, T = frame(k)
    sd = random.choice((-1, 1)); dist = HWS[k] + random.uniform(18, 60)
    c = P + R * (sd * dist) - Vector((0, 0, random.uniform(6, 24)))
    if cloud(f"SB_Wolk_{ci:02d}", c, random.uniform(0.8, 1.6), random.randint(6, 11)): ci += 1
xs = [p.x for p in PS]; ys = [p.y for p in PS]
for _ in range(30):  # wolkenzee diep beneden
    c = Vector((random.uniform(min(xs) - 120, max(xs) + 120), random.uniform(min(ys) - 120, max(ys) + 120), random.uniform(-14, 2)))
    if cloud(f"SB_Wolk_{ci:02d}", c, random.uniform(1.6, 2.6), random.randint(7, 12)): ci += 1

# ------------------------------------------------------------------ lucht
mb = MB(); cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
for _ in range(1400):
    d = Vector((random.gauss(0, 1), random.gauss(0, 1), abs(random.gauss(0, 1)) - 0.25)).normalized()
    c = Vector((cx, cy, 0)) + d * 900; s = random.uniform(0.8, 2.6)
    v = [mb.vert(c + a * s) for a in (Vector((1, 0, 0)), Vector((-1, 0, 0)), Vector((0, 1, 0)), Vector((0, -1, 0)), Vector((0, 0, 1)), Vector((0, 0, -1)))]
    for a, b in ((0, 2), (2, 1), (1, 3), (3, 0)):
        mb.face((v[a], v[b], v[4])); mb.face((v[b], v[a], v[5]))
mb.obj("SB_Hemelsterren", M['hemelster'], C_LUCHT, recalc=True)

bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=40, v_segments=20, radius=70)
bm_obj("SB_Planeet", bm, M['planeet'], C_LUCHT, smooth=True, loc=(-430, 620, 150))
mb = MB(); segs = 72
inner = [mb.vert(Vector((math.cos(2 * math.pi * i / segs) * 95, math.sin(2 * math.pi * i / segs) * 95, 0))) for i in range(segs)]
outer = [mb.vert(Vector((math.cos(2 * math.pi * i / segs) * 150, math.sin(2 * math.pi * i / segs) * 150, 0))) for i in range(segs)]
for i in range(segs):
    j = (i + 1) % segs; mb.face((inner[i], outer[i], outer[j], inner[j]))
rg = mb.obj("SB_PlaneetRing", M['ring'], C_LUCHT)
rg.location = (-430, 620, 150); rg.rotation_euler = (math.radians(22), math.radians(-12), 0)
bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=16, radius=34)
bm_obj("SB_Maan", bm, M['maan'], C_LUCHT, smooth=True, loc=(560, -420, 240))

w = sc.world or bpy.data.worlds.new("SB_Nacht"); sc.world = w; w.use_nodes = True
bg = w.node_tree.nodes.get("Background")
bg.inputs[0].default_value = srgb("#0d1236"); bg.inputs[1].default_value = 1.0
sun = bpy.data.lights.new("SB_Maanlicht", 'SUN'); sun.energy = 2.2; sun.color = (0.82, 0.86, 1.0)
so = bpy.data.objects.new("SB_Maanlicht", sun); C_LUCHT.objects.link(so)
so.rotation_euler = (math.radians(50), math.radians(10), math.radians(140))

# ------------------------------------------------------------------ Takeltje (redt je als je van de baan valt)
tak = bpy.data.objects.new("Takeltje", None); tak.empty_display_type = 'SPHERE'; C_TAK.objects.link(tak)
def tbm(): return bmesh.new()
bm = tbm(); bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=14, radius=0.8, matrix=Matrix.Diagonal((1, 1, 0.92, 1)))
bm_obj("Takeltje_Lijf", bm, M['t_geel'], C_TAK, True, tak)
bm = tbm(); bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=12, radius=0.6,
                                      matrix=Matrix.Translation((0, -0.42, 0.12)) @ Matrix.Diagonal((1.0, 0.62, 0.62, 1)))
bm_obj("Takeltje_Vizier", bm, M['t_vizier'], C_TAK, True, tak)
for sd in (-1, 1):
    bm = tbm(); bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=0.11, matrix=Matrix.Translation((sd * 0.2, -0.79, 0.16)))
    bm_obj(f"Takeltje_Oog_{'L' if sd < 0 else 'R'}", bm, M['t_oog'], C_TAK, True, tak)
    bm = tbm(); bmesh.ops.create_cube(bm, size=1, matrix=Matrix.Translation((sd * 0.86, 0.05, 0.05)) @ Matrix.Diagonal((0.16, 0.5, 0.34, 1)))
    bm_obj(f"Takeltje_Oor_{'L' if sd < 0 else 'R'}", bm, M['t_oranje'], C_TAK, False, tak)
bm = tbm(); bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=0.42, radius2=0.2, depth=0.3, matrix=Matrix.Translation((0, 0, -0.8)))
bm_obj("Takeltje_Straalmotor", bm, M['t_donker'], C_TAK, False, tak)
bm = tbm(); bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=0.3, radius2=0.3, depth=0.04, matrix=Matrix.Translation((0, 0, -0.97)))
bm_obj("Takeltje_Gloed", bm, M['t_oog'], C_TAK, False, tak)
bm = tbm(); bmesh.ops.create_cone(bm, cap_ends=True, segments=10, radius1=0.06, radius2=0.06, depth=0.35, matrix=Matrix.Translation((0, 0, 0.88)))
bm_obj("Takeltje_Mast", bm, M['t_donker'], C_TAK, False, tak)
prop = bpy.data.objects.new("Takeltje_Propeller", None); C_TAK.objects.link(prop); prop.parent = tak; prop.location = (0, 0, 1.08)
bm = tbm(); bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=0.13)
bm_obj("Takeltje_Naaf", bm, M['t_rood'], C_TAK, True, prop)
for i, m in enumerate((M['t_rood'], M['t_wit'])):
    bm = tbm(); bmesh.ops.create_cube(bm, size=1, matrix=Matrix.Rotation(math.pi / 2 * i, 4, 'Z') @ Matrix.Diagonal((1.7, 0.2, 0.04, 1)))
    bm_obj(f"Takeltje_Blad_{i}", bm, m, C_TAK, False, prop)
bm = tbm(); bmesh.ops.create_cone(bm, cap_ends=True, segments=8, radius1=0.035, radius2=0.035, depth=2.7, matrix=Matrix.Translation((0, 0, -0.95 - 1.35)))
bm_obj("Takeltje_Touw", bm, M['t_touw'], C_TAK, False, tak)
# haak: buis langs een boog
mb = MB(); hc = Vector((0, 0, -4.0)); rr = 0.32; path = []
for i in range(19):
    ph = math.radians(90 - i * 16.5); path.append(hc + Vector((math.cos(ph) * rr, 0, math.sin(ph) * rr)))
rings = []
for i, p in enumerate(path):
    t = (path[min(i + 1, 18)] - path[max(i - 1, 0)]).normalized(); n1 = Vector((0, 1, 0)); n2 = t.cross(n1)
    rings.append([mb.vert(p + (n1 * math.cos(2 * math.pi * j / 8) + n2 * math.sin(2 * math.pi * j / 8)) * 0.07) for j in range(8)])
for a, b in zip(rings, rings[1:]):
    for j in range(8): mb.face((a[j], b[j], b[(j + 1) % 8], a[(j + 1) % 8]))
mb.face(rings[0][::-1]); mb.face(rings[-1])
mb.obj("Takeltje_Haak", M['t_metaal'], C_TAK, recalc=True, parent=tak)
# laat Takeltje naast schans 1 zweven, kijkend naar de aankomende karts
s = gaps[0] + 10; P, R, U, T = frame(s); p = P + R * (HWS[s] + 7) + U * 7
tak.matrix_world = Matrix(((R.x, T.x, U.x, p.x), (R.y, T.y, U.y, p.y), (R.z, T.z, U.z, p.z), (0, 0, 0, 1)))
tak.scale = (1.6, 1.6, 1.6)

# ------------------------------------------------------------------ kart ter vergelijking + camera's
kc = bpy.data.collections.get("Knalkart")
if kc:
    inst = bpy.data.objects.new("SB_Kart_Voorbeeld", None); inst.instance_type = 'COLLECTION'; inst.instance_collection = kc
    C_DECOR.objects.link(inst)
    s = N - 9; P, R, U, T = frame(s); p = P + U * 0.06 + R * -3
    inst.matrix_world = Matrix(((-R.x, -T.x, U.x, p.x), (-R.y, -T.y, U.y, p.y), (-R.z, -T.z, U.z, p.z), (0, 0, 0, 1)))

def camera(name, loc, target, lens):
    cd = bpy.data.cameras.new(name); cd.lens = lens; cd.clip_end = 3000
    co = bpy.data.objects.new(name, cd); C_DECOR.objects.link(co); co.location = loc
    co.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    return co
cam_over = camera("SB_Cam_Overzicht", (300, -260, 230), (-20, 160, 10), 24)
P, R, U, T = frame(N - 22)
cam_start = camera("SB_Cam_Start", P + U * 4.2 + R * -3, pt(12, -2, 1.5), 28)
P, R, U, T = frame(gaps[0] - 40)
cam_jump = camera("SB_Cam_Schans", P + U * 6 + R * (HWS[gaps[0]] + 10), pt(gaps[0] + 8, 0, 0), 26)
sc.camera = cam_over
sc.render.engine = 'BLENDER_EEVEE'
sc.render.resolution_x, sc.render.resolution_y = 1280, 720
sc.view_settings.view_transform = 'Standard'

# ------------------------------------------------------------------ baandata voor het spel (three.js-assen)
def g3(v): return [round(v.x, 3), round(v.z, 3), round(-v.y, 3)]
data = {
    "naam": "Sterrenbaan", "N": N, "lengte": N,
    "p": [g3(p) for p in PS], "r": [g3(r) for r in RS], "u": [g3(u) for u in US],
    "hw": [round(h, 2) for h in HWS],
    "rails": [{'L': 1, 'R': 2, 'B': 3}.get(r, 0) for r in RAILS],
    "gat": [int(g) for g in GAP],
    "boost": [{"i": s, "lat": l} for s, l in PADS],
    "poorten": HOOPS, "schansen": gaps, "landingen": landings,
}
with open(os.path.join(DIR, "sterrenbaan.json"), "w") as fh: json.dump(data, fh, separators=(',', ':'))

result = {"N": N, "gaps": gaps, "landings": landings, "pads": PADS, "hoops": HOOPS, "clouds": ci,
          "text": text_ok, "zmin": round(min(p.z for p in PS), 1), "zmax": round(max(p.z for p in PS), 1),
          "maxbank": round(max(abs(b) for b in BANK), 1)}
