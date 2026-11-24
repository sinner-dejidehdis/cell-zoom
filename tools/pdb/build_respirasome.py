"""Build the compact respirasome file the mitochondrion level loads.

Source: RCSB PDB entry 5XTH, the human respiratory supercomplex I1 III2 IV1 (cryo-EM, 3.9 A).
Guo R, Zong S, Wu M, Gu J, Yang M. Architecture of Human Mitochondrial Respiratory Megacomplex
I2III2IV2. Cell 170:1247 (2017). doi:10.1016/j.cell.2017.07.050
Note: in this entry complex I and III are human, but the complex IV model is bovine (Bos taurus).

Run:  python3 tools/pdb/build_respirasome.py   (needs numpy and scikit-image)
Writes public/data/respirasome.bin and respirasome.json:
  - one smooth low-resolution surface per complex (I, III2, IV), computed from all protein atoms,
  - the centre of every redox cofactor (FMN, Fe-S clusters, hemes, copper), used for the electron path,
all in angstrom, in a membrane frame: y = membrane normal pointing to the matrix, origin on the
membrane mid-plane, x = long axis of the complex in the membrane plane.
"""

import gzip
import json
import urllib.request
from pathlib import Path

import numpy as np
from skimage import measure

PDB_ID = "5XTH"
ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / "tools" / "pdb" / "cache"
OUT = ROOT / "public" / "data"

# Entity ranges from the 5XTH entity list on RCSB: 1-44 complex I, 45-57 complex IV, 58-68 complex III.
def complex_of(entity: int) -> str:
    if entity <= 44:
        return "I"
    if entity <= 57:
        return "IV"
    return "III"

# mtDNA-encoded membrane subunits (ND1-6, ND4L, cyt b, COX1-3): their C-alpha atoms define the membrane.
MEMBRANE_CHAINS = {"s", "i", "j", "r", "k", "l", "m", "AJ", "AV", "x", "y", "z"}
# Chain A is NDUFV1 (holds FMN), which sits at the tip of the matrix arm of complex I.
MATRIX_MARKER = "A"
# Low-resolution surface: Gaussian density on a grid (angstrom).
GRID = 6.0
SIGMA = 4.5
VOLUME_PER_ATOM = 18.0

COFACTORS = {"FMN", "SF4", "FES", "HEM", "HEC", "HEA", "CU"}


def fetch() -> list[str]:
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / f"{PDB_ID}.cif.gz"
    if not path.exists():
        urllib.request.urlretrieve(f"https://files.rcsb.org/download/{PDB_ID}.cif.gz", path)
    return gzip.open(path, "rt").read().split("\n")


def parse(lines):
    header, ca, het = [], [], []
    for line in lines:
        if line.startswith("_atom_site."):
            header.append(line.split(".", 1)[1].strip())
            continue
        if header and (line.startswith("ATOM") or line.startswith("HETATM")):
            f = dict(zip(header, line.split()))
            if f.get("label_alt_id", ".") not in (".", "A"):
                continue
            xyz = (float(f["Cartn_x"]), float(f["Cartn_y"]), float(f["Cartn_z"]))
            if f["group_PDB"] == "ATOM":
                ca.append((f["auth_asym_id"], int(f["label_entity_id"]), int(f["auth_seq_id"]), xyz, f["label_atom_id"] == "CA"))
            elif f["group_PDB"] == "HETATM" and f["label_comp_id"] in COFACTORS:
                het.append((f["auth_asym_id"], int(f["label_entity_id"]), f["label_comp_id"], f["auth_seq_id"], xyz))
        elif header and ca:
            break
    return ca, het


def surface(points: np.ndarray):
    """A smooth low-resolution surface around a set of atoms: sum a Gaussian on every atom on a coarse
    grid and take an iso-surface. Detail finer than about 1 nm is lost, the overall shape is kept."""
    lo = points.min(axis=0) - 3 * SIGMA
    shape = np.ceil((points.max(axis=0) + 3 * SIGMA - lo) / GRID).astype(int) + 4
    grid = np.zeros(shape, dtype=np.float32)
    idx = (points - lo) / GRID
    r = int(np.ceil(3 * SIGMA / GRID))
    base = np.floor(idx).astype(int)
    offs = np.arange(-r, r + 2)
    for dx in offs:
        for dy in offs:
            for dz in offs:
                cell = base + (dx, dy, dz)
                d2 = (((cell - idx) * GRID) ** 2).sum(axis=1)
                np.add.at(grid, (cell[:, 0], cell[:, 1], cell[:, 2]), np.exp(-d2 / (2 * SIGMA * SIGMA)))
    # Pick the iso level so the enclosed volume equals the protein's volume (about 18 A^3 per heavy atom,
    # from a partial specific volume of ~1.23 A^3/Da), so the surface is neither inflated nor shrunk.
    target = len(points) * VOLUME_PER_ATOM / GRID ** 3
    flat = np.sort(grid.ravel())[::-1]
    iso = float(flat[int(target)])
    verts, faces, _, _ = measure.marching_cubes(grid, level=iso)
    verts = verts * GRID + lo
    faces = faces[:, ::-1].copy()  # counter-clockwise seen from outside, as three.js expects
    return taubin(verts, faces), faces, iso


def taubin(verts, faces, iterations=10, lam=0.5, mu=-0.53):
    """Smooth away the grid's staircase without shrinking the surface (Taubin 1995)."""
    n = len(verts)
    edges = np.concatenate([faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]]])
    edges = np.unique(np.sort(edges, axis=1), axis=0)
    deg = np.bincount(edges.ravel(), minlength=n).astype(np.float64)[:, None]
    v = verts.astype(np.float64)
    for _ in range(iterations):
        for f in (lam, mu):
            acc = np.zeros_like(v)
            np.add.at(acc, edges[:, 0], v[edges[:, 1]])
            np.add.at(acc, edges[:, 1], v[edges[:, 0]])
            v = v + f * (acc / np.maximum(deg, 1) - v)
    return v


def main() -> None:
    atoms, het = parse(fetch())
    ca = [(c, ent, resi, p) for c, ent, resi, p, is_ca in atoms if is_ca]
    mem = np.array([p for c, _, _, p in ca if c in MEMBRANE_CHAINS])
    centre = mem.mean(axis=0)
    # Smallest-variance axis of the membrane-embedded core = membrane normal.
    _, vecs = np.linalg.eigh(np.cov((mem - centre).T))
    normal, long_axis = vecs[:, 0], vecs[:, 2]
    matrix_tip = np.array([p for c, _, _, p in ca if c == MATRIX_MARKER]).mean(axis=0)
    if np.dot(matrix_tip - centre, normal) < 0:
        normal = -normal
    long_axis -= normal * np.dot(long_axis, normal)
    long_axis /= np.linalg.norm(long_axis)
    third = np.cross(long_axis, normal)
    R = np.stack([long_axis, normal, third])  # rows: x, y, z of the new frame

    def tf(p):
        return (np.asarray(p) - centre) @ R.T

    chain_complex = {c: complex_of(ent) for c, ent, _, _, _ in atoms}
    buf = bytearray()
    parts = []
    for cx in ("I", "III", "IV"):
        pts = tf(np.array([p for c, _, _, p, _ in atoms if chain_complex[c] == cx]))
        verts, faces, iso = surface(pts)
        parts.append({"complex": cx, "atoms": len(pts), "vertexOffset": len(buf), "vertexCount": len(verts), "iso": round(iso, 2)})
        buf += verts.astype("<f4").tobytes()
        parts[-1]["indexOffset"] = len(buf)
        parts[-1]["indexCount"] = faces.size
        buf += faces.astype("<u4").tobytes()

    groups = {}
    for c, _, comp, resi, p in het:
        # Cofactors are non-polymer entities, so take the complex from the chain that holds them.
        groups.setdefault((c, comp, resi, chain_complex[c]), []).append(tf(p))
    cofactors = [{
        "chain": c, "type": comp, "complex": cx,
        "xyz": [round(float(v), 1) for v in np.mean(pts, axis=0)],
    } for (c, comp, resi, cx), pts in sorted(groups.items())]

    allp = tf(np.array([p for _, _, _, p, _ in atoms]))
    mem_y = tf(mem)[:, 1]
    meta = {
        "pdbId": PDB_ID,
        "source": "Guo et al. 2017, Cell 170:1247, doi:10.1016/j.cell.2017.07.050",
        "units": "angstrom",
        "frame": "y = membrane normal towards the matrix; origin = membrane mid-plane",
        "caveat": "complex IV in this entry is modelled from bovine subunits",
        "surface": {"grid": GRID, "sigma": SIGMA, "volumePerAtom": VOLUME_PER_ATOM},
        "bounds": {"min": [round(float(v), 1) for v in allp.min(axis=0)], "max": [round(float(v), 1) for v in allp.max(axis=0)]},
        "parts": parts,
        "cofactors": cofactors,
    }
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "respirasome.bin").write_bytes(bytes(buf))
    (OUT / "respirasome.json").write_text(json.dumps(meta, indent=1))
    print(f"{len(atoms)} protein atoms; membrane core y sd {mem_y.std():.1f} A")
    for pt in parts:
        print(pt["complex"], pt["atoms"], "atoms ->", pt["vertexCount"], "verts,", pt["indexCount"] // 3, "triangles")
    print("bounds", meta["bounds"])


if __name__ == "__main__":
    main()
