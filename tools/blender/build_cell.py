"""Build public/models/cell.glb: the beta cell's membrane, nucleus and Golgi stack.

Units: 1 Blender unit = 1 micrometre.
Mitochondria and insulin granules are NOT in this file: the site places them with
instancing, because their counts are parameters (see src/content/levels.ts).

Run:  python tools/blender/build_cell.py   (with the `bpy` package, Blender 5.3)
"""

import math
import sys
from pathlib import Path

import bpy

sys.path.insert(0, str(Path(__file__).parent))
from common import apply_modifiers, assign, export_glb, material, reset_scene, smooth  # noqa: E402

OUT = Path(__file__).resolve().parents[2] / "public" / "models" / "cell.glb"

CELL_RADIUS = 6.0  # um; illustrative, real human beta-cell size still to be verified
NUCLEUS_RADIUS = 2.4
NUCLEUS_CENTER = (-1.3, 0.4, 0.2)


def membrane():
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=5, radius=CELL_RADIUS)
    obj = bpy.context.object
    obj.name = "Membrane"
    tex = bpy.data.textures.new("membrane_noise", "CLOUDS")
    tex.noise_scale = 1.6
    disp = obj.modifiers.new("shape", "DISPLACE")
    disp.texture = tex
    disp.strength = 0.6
    disp.mid_level = 0.5
    apply_modifiers(obj)
    smooth(obj)
    assign(obj, material("membrane", (0.62, 0.78, 0.86), alpha=0.16, roughness=0.3))


def nucleus():
    bpy.ops.mesh.primitive_uv_sphere_add(segments=64, ring_count=32, radius=NUCLEUS_RADIUS, location=NUCLEUS_CENTER)
    obj = bpy.context.object
    obj.name = "Nucleus"
    obj.scale = (1.0, 0.92, 0.96)
    smooth(obj)
    assign(obj, material("nucleus", (0.42, 0.40, 0.72), alpha=0.9, roughness=0.5))

    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, radius=0.7,
                                         location=(NUCLEUS_CENTER[0] + 0.5, NUCLEUS_CENTER[1] - 0.3, NUCLEUS_CENTER[2] + 0.4))
    nucleolus = bpy.context.object
    nucleolus.name = "Nucleolus"
    smooth(nucleolus)
    assign(nucleolus, material("nucleolus", (0.30, 0.26, 0.55)))


def golgi():
    mat = material("golgi", (0.93, 0.80, 0.42), roughness=0.5)
    base = (1.9, 1.3, 0.9)
    for i in range(5):
        width = 1.25 - 0.08 * abs(i - 2)
        bpy.ops.mesh.primitive_uv_sphere_add(segments=64, ring_count=32, radius=1.0,
                                             location=(base[0] + 0.16 * i, base[1] + 0.05 * i, base[2]))
        obj = bpy.context.object
        obj.name = f"Golgi_{i}"
        obj.scale = (0.05, width, width * 0.45)
        bpy.ops.object.transform_apply(scale=True)
        bend = obj.modifiers.new("bend", "SIMPLE_DEFORM")
        bend.deform_method = "BEND"
        bend.deform_axis = "Z"
        bend.angle = math.radians(55)
        apply_modifiers(obj)
        obj.rotation_euler = (0.0, 0.0, math.radians(-35))
        smooth(obj)
        assign(obj, mat)


def main() -> None:
    reset_scene()
    membrane()
    nucleus()
    golgi()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    export_glb(str(OUT))
    print("wrote", OUT)


if __name__ == "__main__":
    main()
