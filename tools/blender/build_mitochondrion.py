"""Build public/models/mitochondrion.glb (cut-away) and mitochondrion-sites.json.

Units: 1 Blender unit = 50 nm. The organelle is 20 x 8 units = 1.0 x 0.4 um, the size every mitochondrion
in the cell is drawn at (src/engine/anchors.ts). Its overall size and the number of cristae are
illustrative; the membrane dimensions below are measured values (cryo-EM / cryo-ET of mammalian
mitochondria unless noted).

  bilayer thickness           ~6-8 nm, drawn 7 nm   (review: PMC11008732)
  outer + inner boundary      ~20 nm combined, so the bilayer centres are 13 nm apart (same review)
  crista lumen                ~25-30 nm, drawn 25 nm (same review; narrower values have been reported
                              by cryo-ET, which we have not checked)
  crista junction             12-40 nm across (same review); drawn at 16 nm bore
  ATP synthase                dimers in rows along crista rims; within a dimer the two monomers are
                              tilted ~86 deg apart (yeast; >=70 deg in Davies et al. 2011 PNAS);
                              dimers 12->20 nm apart along a row (Davies et al. 2011 PNAS, PMC3161574)
  nucleoid (mtDNA + TFAM)     ~70 nm after correcting for antibody size, ~1.4 mtDNA each
                              (Kukat et al. 2011 PNAS, PMC3158146)

The sites file lists where ATP synthase monomers sit (on the visible half of each crista rim),
converted to the glTF / three.js frame (Y up).

Run:  python tools/blender/build_mitochondrion.py   (with the `bpy` package, Blender 5.3)
"""

import json
import math
import random
import sys
from pathlib import Path

import bpy  # must be imported before bmesh / mathutils
import bmesh
from mathutils import Matrix, Vector

sys.path.insert(0, str(Path(__file__).parent))
from common import (  # noqa: E402
    apply_modifiers, assign, bisect_keep_back, boolean_cut, export_glb, material, reset_scene, shade_by_angle, smooth,
)

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "public" / "models" / "mitochondrion.glb"
SITES = ROOT / "public" / "models" / "mitochondrion-sites.json"

NM = 1 / 50  # units per nanometre
RADIUS = 4.0                  # outer membrane, centre of the bilayer (200 nm)
HALF_LENGTH = 6.0             # cylinder half-length; total length 2 * (6 + 4) = 20 units = 1 um
MEMBRANE = 7 * NM
IBM_RADIUS = RADIUS - 13 * NM  # inner boundary membrane, centre of the bilayer
CRISTA_T = (25 + 2 * 7) * NM / 2  # half-thickness of a crista: lumen plus two bilayers
JUNCTION_BORE = 16 * NM / 2
WALL_GAP = 15 * NM            # free space between a crista's wall-side edge and the boundary membrane
CRISTA_XS = [-8.4, -6.3, -4.2, -2.1, 0.0, 2.1, 4.2, 6.3, 8.4]
CRISTA_AXES = (3.0, 2.5)      # semi-axes of a crista in the cross-section (y, z), illustrative
CRISTA_OFFSET = 1.0           # its centre sits this far towards the wall it grows from
DIMER_HALF_ANGLE = math.radians(43)
DIMER_SPACING = 16 * NM

rand = random.Random(7)


def capsule(name, radius, half_length, u=96, v=48):
    """UV sphere split at its equator and stretched along X into a capsule."""
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=u, v_segments=v, radius=radius)
    for vert in bm.verts:
        if vert.co.z > 1e-6:
            vert.co.z += half_length
        elif vert.co.z < -1e-6:
            vert.co.z -= half_length
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(90), 3, "Y"))
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    smooth(obj)
    return obj


def bilayer(obj) -> None:
    """Give a surface drawn at the bilayer's centre the bilayer's thickness."""
    mod = obj.modifiers.new("bilayer", "SOLIDIFY")
    mod.thickness = MEMBRANE
    mod.offset = 0.0
    apply_modifiers(obj)


def crista_plate(name, x, side, wall_clip):
    """A flattened sac: an oval slab with a fully rounded rim, hollowed out to a bilayer, so a cut through
    it shows two membranes with the crista lumen between them."""
    ay, az = CRISTA_AXES
    zc = -side * CRISTA_OFFSET
    cy, cz = ay - CRISTA_T, az - CRISTA_T  # centre line of the rim
    bm = bmesh.new()
    nt, nphi = 96, 10
    rows = []
    for i in range(nt):
        t = 2 * math.pi * i / nt
        c = Vector((x, cy * math.sin(t), zc + cz * math.cos(t)))
        o = Vector((0, math.sin(t) / cy, math.cos(t) / cz)).normalized()
        rows.append([bm.verts.new(c + CRISTA_T * (o * math.sin(math.pi * k / nphi) + Vector((-1, 0, 0)) * math.cos(math.pi * k / nphi)))
                     for k in range(nphi + 1)])
    for i in range(nt):
        a, b = rows[i], rows[(i + 1) % nt]
        for k in range(nphi):
            bm.faces.new([a[k], b[k], b[k + 1], a[k + 1]])
    for k, dx in ((0, -CRISTA_T), (nphi, CRISTA_T)):  # the two flat faces, as fans
        centre = bm.verts.new((x + dx, 0, zc))
        for i in range(nt):
            a, b = rows[i][k], rows[(i + 1) % nt][k]
            bm.faces.new([centre, b, a] if k == 0 else [centre, a, b])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    boolean_cut(obj, wall_clip, "INTERSECT")  # keep a 15 nm gap to the boundary membrane
    mod = obj.modifiers.new("hollow", "SOLIDIFY")
    mod.thickness = MEMBRANE
    mod.offset = -1.0
    apply_modifiers(obj)
    return obj


def junction(name, x, y, side, inner_r):
    """A crista junction: a short tube from the crista's wall-side edge to the boundary membrane."""
    d = Vector((0, y, -side * math.sqrt(max(inner_r ** 2 - y * y, 0.0)))).normalized()
    a = Vector((x, 0, 0)) + d * (inner_r - WALL_GAP - 4 * NM)
    b = Vector((x, 0, 0)) + d * (IBM_RADIUS + MEMBRANE / 2)
    bm = bmesh.new()
    m = Matrix.Translation((a + b) / 2) @ (b - a).normalized().to_track_quat("Z", "Y").to_matrix().to_4x4()
    bmesh.ops.create_cone(bm, cap_ends=False, segments=20, radius1=JUNCTION_BORE + MEMBRANE,
                          radius2=JUNCTION_BORE + MEMBRANE, depth=(b - a).length, matrix=m)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    mod = obj.modifiers.new("wall", "SOLIDIFY")
    mod.thickness = MEMBRANE
    mod.offset = -1.0
    apply_modifiers(obj)
    smooth(obj)
    return obj


def rim_sites(i, x, side, inner_r):
    """ATP synthase dimers along the free rim of crista i, on the half kept by the cut-away (Blender y >= 0).
    Each dimer is two monomers either side of the ridge, their axes ~86 deg apart."""
    ay, az = CRISTA_AXES
    zc = -side * CRISTA_OFFSET
    cy, cz = ay - CRISTA_T, az - CRISTA_T  # rim centre-line ellipse (the rim is a half-cylinder of radius T)
    sites = []
    # Walk the centre line by arc length from the free tip (t = 0) towards the wall.
    t, step = 0.0, 0.002
    acc = DIMER_SPACING / 2
    prev = None
    while t < math.pi / 2:
        y, z = cy * math.sin(t), zc + side * cz * math.cos(t)
        p = Vector((y, z))
        if prev is not None:
            acc += (p - prev).length
        prev = p
        if math.hypot(y, z) > inner_r - WALL_GAP - 0.4:
            break
        if acc >= DIMER_SPACING:
            acc = 0.0
            out = Vector((0, math.sin(t) / cy, side * math.cos(t) / cz)).normalized()  # rim outward, in (x, y, z)
            centre = Vector((x, y, z))
            for face in (-1, 1):
                nrm = (out * math.cos(DIMER_HALF_ANGLE) + Vector((face, 0, 0)) * math.sin(DIMER_HALF_ANGLE)).normalized()
                q = centre + nrm * (CRISTA_T + 1 * NM)
                # Blender (x, y, z) -> glTF (x, z, -y)
                sites.append({"crista": i, "position": [round(q.x, 4), round(q.z, 4), round(-q.y, 4)],
                              "normal": [round(nrm.x, 4), round(nrm.z, 4), round(-nrm.y, 4)]})
        t += step
    return sites


def matrix_contents(inner_r):
    """Nucleoids and mitochondrial ribosomes in the matrix, between the cristae."""
    nuc_mat = material("nucleoid", (0.36, 0.30, 0.66), roughness=0.7)
    ribo_mat = material("mitoribosome", (0.30, 0.42, 0.56), roughness=0.6)
    placed = []

    def free(p, r):
        if math.hypot(p.y, p.z) > inner_r - r - 0.1 or abs(p.x) > HALF_LENGTH + 1.5:
            return False
        if min(abs(p.x - cx) for cx in CRISTA_XS) < CRISTA_T + r + 0.02:
            return False
        return all((p - q).length > r + rq + 0.05 for q, rq in placed)

    objs = []
    for kind, count, r, mat in (("Nucleoid", 2, 35 * NM, nuc_mat), ("Mitoribosome", 30, 15 * NM, ribo_mat)):
        made = 0
        for _ in range(20000):
            if made == count:
                break
            p = Vector((rand.uniform(-8.5, 8.5), rand.uniform(-0.3, 3.2), rand.uniform(-3.2, 3.2)))
            if not free(p, r):
                continue
            placed.append((p, r))
            bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3, radius=r, location=p)
            o = bpy.context.object
            o.name = f"{kind}_{made}"
            if kind == "Nucleoid":
                tex = bpy.data.textures.new(f"nucleoid_{made}", "CLOUDS")
                tex.noise_scale = 0.25
                disp = o.modifiers.new("lumpy", "DISPLACE")
                disp.texture = tex
                disp.strength = 0.15
                apply_modifiers(o)
            smooth(o)
            assign(o, mat)
            objs.append(o)
            made += 1
    return objs


def main() -> None:
    reset_scene()
    outer_mat = material("outer_membrane", (0.96, 0.62, 0.42), roughness=0.45)
    inner_mat = material("inner_membrane", (0.88, 0.40, 0.33), roughness=0.5)

    outer = capsule("OuterMembrane", RADIUS, HALF_LENGTH)
    bilayer(outer)
    assign(outer, outer_mat)

    inner = capsule("InnerBoundaryMembrane", IBM_RADIUS, HALF_LENGTH)
    bilayer(inner)
    assign(inner, inner_mat)

    inner_r = IBM_RADIUS - MEMBRANE / 2  # inner surface of the boundary membrane
    wall_clip = capsule("WallClip", inner_r - WALL_GAP, HALF_LENGTH, 48, 24)

    parts = [outer, inner]
    sites = []
    for i, x in enumerate(CRISTA_XS):
        side = 1 if i % 2 == 0 else -1  # alternate the wall each crista grows from
        c = crista_plate(f"Crista_{i}", x, side, wall_clip)
        assign(c, inner_mat)
        parts.append(c)
        for k, y in enumerate((0.7, 2.0, -1.2)):
            j = junction(f"Junction_{i}_{k}", x, y, side, inner_r)
            assign(j, inner_mat)
            parts.append(j)
        sites += rim_sites(i, x, side, inner_r)
    bpy.data.objects.remove(wall_clip)

    parts += matrix_contents(inner_r)
    for obj in parts:
        bisect_keep_back(obj)
        shade_by_angle(obj)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    export_glb(str(OUT))
    SITES.write_text(json.dumps({"unitsPerMetre": 2e7, "sites": sites}, indent=1))
    print("wrote", OUT, "and", len(sites), "sites")


if __name__ == "__main__":
    main()
