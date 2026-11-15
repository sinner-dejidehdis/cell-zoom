"""Shared helpers for the Blender build scripts (run with the `bpy` module, Blender 5.3)."""

import bpy


def reset_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def material(name: str, rgb: tuple[float, float, float], alpha: float = 1.0, roughness: float = 0.6):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    if alpha < 1.0:
        bsdf.inputs["Alpha"].default_value = alpha
        mat.surface_render_method = "BLENDED"
    return mat


def assign(obj, mat) -> None:
    obj.data.materials.clear()
    obj.data.materials.append(mat)


def smooth(obj) -> None:
    for poly in obj.data.polygons:
        poly.use_smooth = True


def apply_modifiers(obj) -> None:
    bpy.context.view_layer.objects.active = obj
    for mod in list(obj.modifiers):
        bpy.ops.object.modifier_apply(modifier=mod.name)


def boolean_cut(target, cutter, operation: str = "DIFFERENCE") -> None:
    mod = target.modifiers.new("cut", "BOOLEAN")
    mod.operation = operation
    mod.object = cutter
    mod.solver = "EXACT"
    apply_modifiers(target)


def export_glb(path: str) -> None:
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        export_apply=True,
        export_yup=True,
    )


def bisect_keep_back(obj) -> None:
    """Cut the mesh with the plane y = 0 and keep the y >= 0 half (the half away from the viewer).

    A plane bisect gives clean geometry; a boolean with a box leaves long thin triangles that
    shade as streaks once smooth shading is on.
    """
    import bmesh  # imported here because bmesh needs bpy loaded first

    bm = bmesh.new()
    bm.from_mesh(obj.data)
    geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
    bmesh.ops.bisect_plane(bm, geom=geom, plane_co=(0, 0, 0), plane_no=(0, -1, 0), clear_outer=True)
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()


def shade_by_angle(obj, degrees: float = 40.0) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.shade_smooth_by_angle(angle=__import__("math").radians(degrees))
