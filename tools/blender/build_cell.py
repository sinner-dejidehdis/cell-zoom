"""Build public/models/cell.glb and src/content/cell-layout.json.

The glb holds everything in the beta cell that is not a mitochondrion or an insulin granule:
plasma membrane, nucleus (envelope, pores, chromatin, nucleolus), rough ER, Golgi stacks with
their vesicles, and the primary cilium with its basal body. Mitochondria and granules are drawn
by the site with instancing, because their counts are parameters (src/content/levels.ts).

cell-layout.json tells the site where those structures are (in the glTF / three.js frame, Y up,
1 unit = 1 um), so that it can place mitochondria and granules inside the cell and around them.

Which numbers come from measurements and which are illustrative is written next to each constant
and repeated in the panel text (src/i18n/zh.json).

Run:  python tools/blender/build_cell.py   (with the `bpy` package, Blender 5.3)
"""

import json
import math
import random
import sys
from pathlib import Path

import bpy  # must be imported before bmesh / mathutils
import bmesh
from mathutils import Matrix, Quaternion, Vector

sys.path.insert(0, str(Path(__file__).parent))
from common import apply_modifiers, assign, export_glb, material, reset_scene, smooth  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "public" / "models" / "cell.glb"
LAYOUT = ROOT / "src" / "content" / "cell-layout.json"

# ---- Numbers -------------------------------------------------------------------------------------
# Measured (human): mean beta-cell volume 1,158 um3 (stereology of human pancreas, PubMed 22797400).
CELL_VOLUME = 1158.0
# Illustrative: beta cells in an islet are packed polyhedra. The shape here is a jittered truncated
# octahedron (14 faces, the shape that packs space with the fewest faces) with rounded edges.
EDGE_ROUND = 0.9
# Rat model value (Fava et al. 2012, Diabetologia, PMC3296007): nucleus 5.6 um across. No human value found.
NUCLEUS_RADII = (2.95, 2.65, 2.8)  # um, ellipsoid of the same volume as a 5.6 um sphere (92 um3)
NUCLEUS_CENTER = (-0.9, -0.5, 0.4)
# Human: nuclear pore complex about 120 nm across (cryo-ET of human NPC, von Appen et al. 2015 Nature).
# The number of pores is illustrative (~8 per um2).
PORE_OUTER = 0.12
PORES = 800
# Human: primary cilia on islet cells 3-6 um long by scanning EM (Polino et al. 2023 PNAS, PMC10235940).
CILIUM_LENGTH = 4.5
CILIUM_RADIUS = 0.13
# Everything else below (ER sheets, Golgi stacks, vesicle sizes, chromatin) is illustrative.

rand = random.Random(20261115)


def to_blender(v):
    """glTF / three.js (Y up) -> Blender (Z up). The exporter maps Blender (x, y, z) to (x, z, -y)."""
    x, y, z = v
    return Vector((x, -z, y))


def to_site(v):
    return [round(v[0], 4), round(v[2], 4), round(-v[1], 4)]


def quat_to_site(q: Quaternion):
    # Rotation in Blender frame -> rotation in Y-up frame: conjugate by the axis change.
    c = Quaternion((1, 0, 0), math.radians(-90))  # Blender -> site
    s = c @ q @ c.inverted()
    return [round(s.x, 5), round(s.y, 5), round(s.z, 5), round(s.w, 5)]


def new_object(name, bm, mat):
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    assign(obj, mat)
    return obj


# ---- Membrane --------------------------------------------------------------------------------------

def jittered_normals():
    base = [Vector(v) for v in [(1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)]]
    hexes = [Vector((sx, sy, sz)).normalized() for sx in (1, -1) for sy in (1, -1) for sz in (1, -1)]
    out = []
    for n, d in [(n, 1.0) for n in base] + [(n, 0.87) for n in hexes]:
        axis = Vector((rand.uniform(-1, 1), rand.uniform(-1, 1), rand.uniform(-1, 1))).normalized()
        n = (Quaternion(axis, math.radians(rand.uniform(0, 12))) @ n).normalized()
        out.append((n, d * rand.uniform(0.9, 1.1)))
    return out


def membrane():
    """A rounded polyhedron of the measured volume. Returns its planes in the Blender frame."""
    planes = jittered_normals()
    # Squash the cell a little along the apical-basal axis (Blender Z): illustrative.
    planes = [(n, d * (0.92 if abs(n.z) > 0.8 else 1.0)) for n, d in planes]
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=4.0)
    for n, d in planes:
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        res = bmesh.ops.bisect_plane(bm, geom=geom, plane_co=n * d, plane_no=n, clear_outer=True)
        cut = [e for e in res["geom_cut"] if isinstance(e, bmesh.types.BMEdge)]
        if cut:
            bmesh.ops.holes_fill(bm, edges=cut, sides=0)
    bmesh.ops.bevel(bm, geom=bm.edges[:] + bm.verts[:], offset=EDGE_ROUND / 6.5, segments=5, affect="EDGES", profile=0.5)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    vol = bm.calc_volume()
    k = (CELL_VOLUME / vol) ** (1 / 3)
    bmesh.ops.scale(bm, vec=(k, k, k), verts=bm.verts)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    print(f"cell: polyhedron volume {bm.calc_volume():.1f} um3, scale {k:.3f}")
    obj = new_object("Membrane", bm, material("membrane", (0.62, 0.78, 0.86), alpha=0.14, roughness=0.3))
    # Gentle surface relief so the membrane does not look machined.
    sub = obj.modifiers.new("sub", "SUBSURF")
    sub.levels = 1
    tex = bpy.data.textures.new("membrane_noise", "CLOUDS")
    tex.noise_scale = 2.5
    disp = obj.modifiers.new("relief", "DISPLACE")
    disp.texture = tex
    disp.strength = 0.18
    apply_modifiers(obj)
    smooth(obj)
    return [(n, d * k) for n, d in planes]


# ---- Nucleus ---------------------------------------------------------------------------------------

def nucleus():
    c = to_blender(NUCLEUS_CENTER)
    rx, ry, rz = NUCLEUS_RADII  # site axes
    scale_b = Vector((rx, rz, ry))  # Blender axes
    bpy.ops.mesh.primitive_uv_sphere_add(segments=96, ring_count=48, radius=1.0, location=c)
    env = bpy.context.object
    env.name = "NuclearEnvelope"
    env.scale = scale_b
    bpy.ops.object.transform_apply(scale=True)
    smooth(env)
    assign(env, material("nuclear_envelope", (0.50, 0.46, 0.80), alpha=0.32, roughness=0.45))

    # Pores: rings in the envelope, spread evenly (Fibonacci sphere) with a little jitter.
    bm = bmesh.new()
    ring = bmesh.new()
    bmesh.ops.create_circle(ring, segments=10, radius=1.0)
    golden = math.pi * (3 - math.sqrt(5))
    major = PORE_OUTER / 2 - 0.015
    for i in range(PORES):
        y = 1 - 2 * (i + 0.5) / PORES
        r = math.sqrt(1 - y * y)
        t = golden * i + rand.uniform(-0.3, 0.3)
        u = Vector((math.cos(t) * r, math.sin(t) * r, y))
        p = Vector((u.x * scale_b.x, u.y * scale_b.y, u.z * scale_b.z))
        nrm = Vector((u.x / scale_b.x, u.y / scale_b.y, u.z / scale_b.z)).normalized()
        rot = nrm.to_track_quat("Z", "Y").to_matrix().to_4x4()
        m = Matrix.Translation(c + p) @ rot
        bmesh.ops.create_cone(bm, cap_ends=False, segments=10, radius1=major + 0.015, radius2=major, depth=0.04, matrix=m)
    ring.free()
    pores = new_object("NuclearPores", bm, material("pores", (0.86, 0.84, 0.98), roughness=0.4))
    smooth(pores)

    # Heterochromatin: dark patches lining the envelope, plus a few inside. Illustrative.
    chrom = material("heterochromatin", (0.22, 0.16, 0.40), roughness=0.8)
    for i in range(110):
        u = Vector((rand.gauss(0, 1), rand.gauss(0, 1), rand.gauss(0, 1))).normalized()
        depth = 0.93 if i < 95 else rand.uniform(0.2, 0.6)
        p = Vector((u.x * scale_b.x, u.y * scale_b.y, u.z * scale_b.z)) * depth
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=1.0, location=c + p)
        o = bpy.context.object
        o.name = f"Chromatin_{i}"
        s = rand.uniform(0.18, 0.38)
        o.scale = (s, s * rand.uniform(0.5, 0.9), s * (0.22 if i < 95 else 0.7))
        o.rotation_mode = "QUATERNION"
        o.rotation_quaternion = u.to_track_quat("Z", "Y") if i < 95 else Quaternion()
        smooth(o)
        assign(o, chrom)

    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=4, radius=0.75, location=c + Vector((0.6, -0.4, 0.3)))
    nucleolus = bpy.context.object
    nucleolus.name = "Nucleolus"
    tex = bpy.data.textures.new("nucleolus_noise", "CLOUDS")
    tex.noise_scale = 0.25
    disp = nucleolus.modifiers.new("lumpy", "DISPLACE")
    disp.texture = tex
    disp.strength = 0.18
    apply_modifiers(nucleolus)
    smooth(nucleolus)
    assign(nucleolus, material("nucleolus", (0.36, 0.22, 0.52), roughness=0.6))


# ---- Rough ER --------------------------------------------------------------------------------------

def sheet(bm, w, h, bend, matrix, nx=18, ny=10, thick=0.05, rim=0.0):
    """A curved, oval sheet (cisterna) about w x h, as a closed slab, added to bm.
    `rim` swells the edge (Golgi cisternae have dilated rims)."""
    verts = {}
    for side, sgn in ((0, -1), (1, 1)):
        for i in range(nx + 1):
            for j in range(ny + 1):
                a, b = i / nx * 2 - 1, j / ny * 2 - 1
                a, b = a * math.sqrt(1 - b * b / 2), b * math.sqrt(1 - a * a / 2)  # square -> disc
                rr = math.hypot(a, b)
                u, v = a * w / 2, b * h / 2
                half = thick / 2 * (1 + rim * rr ** 6) * (0.35 + 0.65 * math.sqrt(max(0.0, 1 - rr ** 8)))
                z = bend * (u * u) / w + 0.04 * math.sin(3.1 * v + 1.7 * u) + sgn * half
                verts[side, i, j] = bm.verts.new(matrix @ Vector((u, v, z)))
    for i in range(nx):
        for j in range(ny):
            a, b, c2, d = (0, i, j), (0, i + 1, j), (0, i + 1, j + 1), (0, i, j + 1)
            bm.faces.new([verts[a], verts[d], verts[c2], verts[b]])
            a, b, c2, d = (1, i, j), (1, i + 1, j), (1, i + 1, j + 1), (1, i, j + 1)
            bm.faces.new([verts[a], verts[b], verts[c2], verts[d]])
    for i in range(nx):  # rims along u
        for j in (0, ny):
            q = [verts[0, i, j], verts[0, i + 1, j], verts[1, i + 1, j], verts[1, i, j]]
            bm.faces.new(q if j == 0 else q[::-1])
    for j in range(ny):  # rims along v
        for i in (0, nx):
            q = [verts[0, i, j], verts[1, i, j], verts[1, i, j + 1], verts[0, i, j + 1]]
            bm.faces.new(q if i == 0 else q[::-1])


def er_and_golgi(planes):
    exclusions = []
    nuc = to_blender(NUCLEUS_CENTER)
    rx, ry, rz = NUCLEUS_RADII
    nscale = Vector((rx, rz, ry))

    def inside_cell(p, margin):
        return all(n.dot(p) <= d - margin for n, d in planes)

    def clear_of_nucleus(p, margin):
        q = p - nuc
        return Vector((q.x / (nscale.x + margin), q.y / (nscale.y + margin), q.z / (nscale.z + margin))).length > 1

    def clear_of(p, r):
        for e in exclusions:
            if (p - e["_c"]).length < r + e["_r"]:
                return False
        return True

    # Golgi: a ribbon of three stacks curving around one side of the nucleus. Each stack has six
    # cisternae, smallest on the trans face, with vesicles at the rims.
    golgi_mat = material("golgi", (0.93, 0.80, 0.42), roughness=0.5)
    vesicle_mat = material("golgi_vesicle", (0.98, 0.88, 0.58), roughness=0.4)
    gbm = bmesh.new()
    vbm = bmesh.new()
    golgi_dir = Vector((0.85, 0.35, 0.4)).normalized()  # from the nucleus, Blender frame
    for k in range(3):
        a = math.radians(-32 + 32 * k)
        d = (Quaternion((0, 0, 1), a) @ golgi_dir).normalized()
        surf = Vector((d.x * nscale.x, d.y * nscale.y, d.z * nscale.z)).length
        centre = nuc + d * (surf + 0.75)
        rot = d.to_track_quat("Z", "Y")
        for i in range(6):
            w = 1.5 - 0.12 * i
            m = Matrix.Translation(centre + d * (i - 2.5) * 0.11) @ rot.to_matrix().to_4x4()
            sheet(gbm, w, w * 0.55, 0.22, m, nx=20, ny=12, thick=0.035, rim=1.6)
            for _ in range(5):
                side = rand.choice((-1, 1))
                p = m @ Vector((side * (w / 2 + rand.uniform(0.05, 0.18)), rand.uniform(-0.3, 0.3), rand.uniform(-0.1, 0.1)))
                bmesh.ops.create_icosphere(vbm, subdivisions=1, radius=0.035, matrix=Matrix.Translation(p))
        exclusions.append({"_c": centre, "_r": 1.0})
    golgi = new_object("Golgi", gbm, golgi_mat)
    smooth(golgi)
    ves = new_object("GolgiVesicles", vbm, vesicle_mat)
    smooth(ves)

    # Rough ER: stacks of parallel sheets, some hugging the nucleus, some out in the cytoplasm.
    er_mat = material("rough_er", (0.42, 0.74, 0.68), roughness=0.55)
    ebm = bmesh.new()
    placed = 0
    tries = 0
    while placed < 14 and tries < 4000:
        tries += 1
        perinuclear = placed < 5
        if perinuclear:
            u = Vector((rand.gauss(0, 1), rand.gauss(0, 1), rand.gauss(0, 1))).normalized()
            if u.dot(golgi_dir) > 0.3:
                continue
            surf = Vector((u.x * nscale.x, u.y * nscale.y, u.z * nscale.z))
            centre = nuc + surf + u * 0.45
            normal = u
        else:
            centre = Vector((rand.uniform(-6, 6), rand.uniform(-6, 6), rand.uniform(-6, 6)))
            normal = Vector((rand.gauss(0, 1), rand.gauss(0, 1), rand.gauss(0, 1))).normalized()
        w, h = rand.uniform(1.6, 2.6), rand.uniform(0.9, 1.4)
        layers = rand.randint(3, 5)
        r = math.hypot(w, h) / 2 + 0.1
        if not inside_cell(centre, r + 0.2) or not clear_of_nucleus(centre, 0.3 if perinuclear else r) or not clear_of(centre, r):
            continue
        rot = normal.to_track_quat("Z", "Y") @ Quaternion((0, 0, 1), rand.uniform(0, math.pi))
        for i in range(layers):
            m = Matrix.Translation(centre + normal * (i - (layers - 1) / 2) * 0.13) @ rot.to_matrix().to_4x4()
            sheet(ebm, w, h, -0.18 if perinuclear else rand.uniform(-0.25, 0.25), m)
        exclusions.append({"_c": centre, "_r": r * 0.8})
        placed += 1
    er = new_object("RoughER", ebm, er_mat)
    smooth(er)
    print(f"ER stacks: {placed}")
    return exclusions


# ---- Primary cilium --------------------------------------------------------------------------------

def cilium(planes):
    """The cilium leaves the cell through the apical face (+Z in Blender, +Y on the site)."""
    n, d = max(planes, key=lambda pd: pd[0].z)
    base = n * (d - 0.35)
    bm = bmesh.new()
    pts = []
    for i in range(41):
        t = i / 40
        s = t * CILIUM_LENGTH
        bend = Vector((0.6 * math.sin(t * 1.4), 0.25 * t * t, 0))
        pts.append(base + n * s + bend * t * CILIUM_LENGTH / 3)
    curve = bpy.data.curves.new("cilium", "CURVE")
    curve.dimensions = "3D"
    spline = curve.splines.new("POLY")
    spline.points.add(len(pts) - 1)
    for p, sp in zip(pts, spline.points):
        sp.co = (*p, 1.0)
    curve.bevel_depth = CILIUM_RADIUS
    curve.bevel_resolution = 4
    curve.use_fill_caps = True
    obj = bpy.data.objects.new("Cilium", curve)
    bpy.context.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target="MESH")
    smooth(obj)
    assign(obj, material("cilium", (0.80, 0.90, 0.95), roughness=0.35))
    bm.free()

    # Basal body (mother centriole) under the cilium, and the daughter centriole at right angles.
    cmat = material("centriole", (0.70, 0.86, 0.80), roughness=0.5)
    rot = n.to_track_quat("Z", "Y").to_matrix().to_4x4()
    for name, m in (("MotherCentriole", Matrix.Translation(base - n * 0.25) @ rot),
                    ("DaughterCentriole", Matrix.Translation(base - n * 0.6) @ rot @ Matrix.Rotation(math.pi / 2, 4, "X"))):
        cbm = bmesh.new()
        bmesh.ops.create_cone(cbm, cap_ends=True, segments=18, radius1=0.11, radius2=0.11, depth=0.42, matrix=m)
        new_object(name, cbm, cmat)
    return {"base": to_site(base), "dir": to_site(n), "length": CILIUM_LENGTH, "radius": CILIUM_RADIUS}, base - n * 0.4


def main() -> None:
    reset_scene()
    planes = membrane()
    nucleus()
    exclusions = er_and_golgi(planes)
    cil, centriole_at = cilium(planes)
    exclusions.append({"_c": centriole_at, "_r": 0.5})
    OUT.parent.mkdir(parents=True, exist_ok=True)
    export_glb(str(OUT))
    layout = {
        "note": "Generated by tools/blender/build_cell.py. Y up, 1 unit = 1 um.",
        "volume": CELL_VOLUME,
        "planes": [{"n": to_site(n), "d": round(d, 4)} for n, d in planes],
        "edgeRound": EDGE_ROUND,
        "nucleus": {"center": list(NUCLEUS_CENTER), "radii": list(NUCLEUS_RADII)},
        "cilium": cil,
        "exclusions": [{"c": to_site(e["_c"]), "r": round(e["_r"], 3)} for e in exclusions],
    }
    LAYOUT.write_text(json.dumps(layout, indent=1) + "\n")
    print("wrote", OUT, "and", LAYOUT)


if __name__ == "__main__":
    main()
