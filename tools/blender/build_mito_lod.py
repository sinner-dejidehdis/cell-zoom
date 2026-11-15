"""Build public/models/mitochondrion-lod.glb: the low-detail mitochondrion drawn 330 times in the cell.

Same proportions and the same nine lamellar cristae as the detailed model (build_mitochondrion.py), in
the same model units (20 x 8 units; the site scales it to 1.0 x 0.4 um), but closed (not cut open) and
with far fewer polygons. Two meshes:
  Outer  - the outer membrane
  Inner  - the inner boundary membrane and the cristae
so that a cut through the cell shows the cristae inside.

Run:  python tools/blender/build_mito_lod.py   (with the `bpy` package, Blender 5.3)
"""

import math
import sys
from pathlib import Path

import bpy  # must be imported before bmesh / mathutils
import bmesh
from mathutils import Matrix

sys.path.insert(0, str(Path(__file__).parent))
from common import assign, boolean_cut, export_glb, material, reset_scene, smooth  # noqa: E402

OUT = Path(__file__).resolve().parents[2] / "public" / "models" / "mitochondrion-lod.glb"

RADIUS = 4.0
HALF_LENGTH = 6.0
GAP = 0.26  # 13 nm between bilayer centres, as in the detailed model
CRISTA_HALF_THICKNESS = 0.39  # 39 nm crista: 25 nm lumen + two 7 nm bilayers
CRISTA_XS = [-8.4, -6.3, -4.2, -2.1, 0.0, 2.1, 4.2, 6.3, 8.4]


def capsule(name, radius, half_length, u=24, v=12):
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


def main() -> None:
    reset_scene()
    outer = capsule("Outer", RADIUS, HALF_LENGTH)
    assign(outer, material("outer_membrane", (0.96, 0.62, 0.42), roughness=0.45))
    inner_mat = material("inner_membrane", (0.86, 0.36, 0.30), roughness=0.5)
    inner = capsule("Inner", RADIUS - GAP, HALF_LENGTH)
    assign(inner, inner_mat)
    matrix = capsule("Matrix", RADIUS - GAP - 0.4, HALF_LENGTH, 20, 10)

    parts = [inner]
    for i, x in enumerate(CRISTA_XS):
        side = 1 if i % 2 == 0 else -1
        bpy.ops.mesh.primitive_uv_sphere_add(segments=14, ring_count=8, radius=1.0, location=(x, 0.0, -side * 1.0))
        crista = bpy.context.object
        crista.name = f"Crista_{i}"
        crista.scale = (CRISTA_HALF_THICKNESS, 3.0, 2.5)
        bpy.ops.object.transform_apply(scale=True, location=False)
        boolean_cut(crista, matrix, "INTERSECT")
        smooth(crista)
        assign(crista, inner_mat)
        parts.append(crista)
    bpy.data.objects.remove(matrix)

    bpy.ops.object.select_all(action="DESELECT")
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = inner
    bpy.ops.object.join()
    tris = sum(len(p.vertices) - 2 for o in (outer, inner) for p in o.data.polygons)
    print(f"mitochondrion LOD: {tris} triangles")
    export_glb(str(OUT))
    print("wrote", OUT)


if __name__ == "__main__":
    main()
