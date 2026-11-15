"""Build public/models/mitochondrion.glb (cut-away) and mitochondrion-sites.json.

Units: 1 Blender unit = 100 nm. The organelle is 2 um long and 0.8 um wide, which is
within the commonly cited size range; it is a representative shape, not a measured one.
Cristae are drawn as lamellar plates (the common form in many mammalian cells).

The sites file lists points on the crista rims where ATP synthase dimers sit,
converted to the glTF / three.js frame (Y up).

Run:  python tools/blender/build_mitochondrion.py   (with the `bpy` package, Blender 5.3)
"""

import json
import math
import sys
from pathlib import Path

import bpy  # must be imported before bmesh / mathutils
import bmesh
from mathutils import Matrix

sys.path.insert(0, str(Path(__file__).parent))
from common import (  # noqa: E402
    apply_modifiers, assign, bisect_keep_back, boolean_cut, export_glb, material, reset_scene, shade_by_angle, smooth,
)

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "public" / "models" / "mitochondrion.glb"
SITES = ROOT / "public" / "models" / "mitochondrion-sites.json"

RADIUS = 4.0         # 400 nm
HALF_LENGTH = 6.0    # cylinder half-length; total length = 2 * (6 + 4) = 20 units = 2 um
GAP = 0.22           # ~22 nm intermembrane space
MEMBRANE = 0.07      # ~7 nm lipid bilayer
CRISTA_HALF_THICKNESS = 0.12
CRISTA_XS = [-8.4, -6.3, -4.2, -2.1, 0.0, 2.1, 4.2, 6.3, 8.4]


def capsule(name: str, radius: float, half_length: float):
    """UV sphere split at its equator and stretched along X into a capsule."""
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=96, v_segments=48, radius=radius)
    for v in bm.verts:
        if v.co.z > 1e-6:
            v.co.z += half_length
        elif v.co.z < -1e-6:
            v.co.z -= half_length
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0),
                     matrix=Matrix.Rotation(math.radians(90), 3, "Y"))
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    smooth(obj)
    return obj


def shell(obj, thickness: float) -> None:
    mod = obj.modifiers.new("shell", "SOLIDIFY")
    mod.thickness = thickness
    mod.offset = -1.0
    apply_modifiers(obj)



def main() -> None:
    reset_scene()
    outer_mat = material("outer_membrane", (0.96, 0.62, 0.42), roughness=0.45)
    inner_mat = material("inner_membrane", (0.88, 0.40, 0.33), roughness=0.5)
    matrix_mat = material("matrix", (0.98, 0.86, 0.76), alpha=0.25, roughness=0.8)

    outer = capsule("OuterMembrane", RADIUS, HALF_LENGTH)
    shell(outer, MEMBRANE)
    assign(outer, outer_mat)

    inner = capsule("InnerBoundaryMembrane", RADIUS - GAP, HALF_LENGTH)
    shell(inner, MEMBRANE)
    assign(inner, inner_mat)

    # Matrix volume, used to trim the cristae and drawn as a faint fill.
    matrix = capsule("Matrix", RADIUS - GAP - MEMBRANE, HALF_LENGTH)
    assign(matrix, matrix_mat)

    sites = []
    for i, x in enumerate(CRISTA_XS):
        side = 1 if i % 2 == 0 else -1  # alternate the wall each crista grows from
        bpy.ops.mesh.primitive_uv_sphere_add(segments=64, ring_count=32, radius=1.0,
                                             location=(x, 0.0, -side * 1.3))
        crista = bpy.context.object
        crista.name = f"Crista_{i}"
        crista.scale = (CRISTA_HALF_THICKNESS, 3.5, 2.9)
        bpy.ops.object.transform_apply(scale=True, location=False)
        boolean_cut(crista, matrix, "INTERSECT")
        smooth(crista)
        assign(crista, inner_mat)

        # Rim points: the free edge of the plate, on the half that survives the cut-away (Blender y >= 0).
        # The ellipse in the y-z plane is y = 3.5 sin t, z = zc + side * 2.9 cos t; t = 0 is the free tip.
        zc = -side * 1.3
        for k in range(0, 10):
            t = (math.pi / 2) * k / 9
            y = 3.5 * math.sin(t)
            z = zc + side * 2.9 * math.cos(t)
            if math.hypot(y, z) > RADIUS - GAP - 0.3:
                continue
            for face in (-1, 1):
                bx, by, bz = x + face * (CRISTA_HALF_THICKNESS + 0.02), y, z
                # Blender (x, y, z) -> glTF (x, z, -y)
                sites.append({"crista": i, "position": [round(bx, 3), round(bz, 3), round(-by, 3)], "normal": [face, 0, 0]})

    for obj in [outer, inner] + [o for o in bpy.data.objects if o.name.startswith("Crista_")]:
        bisect_keep_back(obj)
        shade_by_angle(obj)
    # The matrix volume was only needed to trim the cristae; a translucent fill reads as noise on screen.
    bpy.data.objects.remove(matrix)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    export_glb(str(OUT))
    SITES.write_text(json.dumps({"unitsPerMetre": 1e7, "sites": sites}, indent=1))
    print("wrote", OUT, "and", len(sites), "sites")


if __name__ == "__main__":
    main()
