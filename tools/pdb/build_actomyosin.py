"""Build the structure files for the molecular and atomic levels of the muscle page.

Sources (RCSB PDB, cryo-EM):
  8EFI  human cardiac actin-tropomyosin-myosin, rigor (3.4 A): myosin-7 (MYH7, human; the same myosin
        heavy chain as human slow, type I skeletal fibres), alpha-cardiac actin (pig), tropomyosin TPM1 (human).
  6KN7  thin filament, calcium free (6.6 A); 6KN8 the same with calcium bound (4.8 A):
        rabbit skeletal alpha-actin, human cardiac tropomyosin and troponin.

Everything is expressed in a "filament frame": X along the actin filament axis pointing to the pointed end
(the end that faces the M-line in a sarcomere), origin on the axis at the height of a reference actin, and
that actin's centroid on +Y. Then any actin subunit n of a filament is placed by rotating n * TWIST about X
and moving n * RISE along X.

Run:  python3 tools/pdb/build_actomyosin.py   (needs numpy)
Writes public/data/actomyosin.bin and actomyosin.json.
"""

import gzip
import json
import math
import struct
import urllib.request
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / "tools" / "pdb" / "cache"
OUT = ROOT / "public" / "data"

# Helical symmetry reported for 8EFI (RCSB em_helical_entity): rise 27.9 A, rotation -166.4 deg per subunit.
RISE = 27.9
TWIST = -166.4

ELEMENTS = ["C", "N", "O", "S", "P", "MG", "OTHER"]
ROLES = {"actin": 0, "myosin": 1, "tropomyosin": 2, "ligand": 3}


def fetch(pdb_id: str) -> list[str]:
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / f"{pdb_id}.cif.gz"
    if not path.exists():
        urllib.request.urlretrieve(f"https://files.rcsb.org/download/{pdb_id}.cif.gz", path)
    return gzip.open(path, "rt").read().split("\n")


def parse_atoms(lines: list[str]) -> list[dict]:
    header: list[str] = []
    atoms = []
    for line in lines:
        if line.startswith("_atom_site."):
            header.append(line.split(".", 1)[1].strip())
            continue
        if header and (line.startswith("ATOM") or line.startswith("HETATM")):
            f = dict(zip(header, line.split()))
            if f.get("label_alt_id", ".") not in (".", "A") or f["type_symbol"] in ("H", "D"):
                continue
            atoms.append({
                "het": f["group_PDB"] == "HETATM",
                "el": f["type_symbol"].upper(),
                "name": f["label_atom_id"].strip('"'),
                "resn": f["label_comp_id"],
                "resi": int(f["auth_seq_id"]) if f["auth_seq_id"].lstrip("-").isdigit() else 0,
                "chain": f["auth_asym_id"],
                "xyz": np.array([float(f["Cartn_x"]), float(f["Cartn_y"]), float(f["Cartn_z"])]),
            })
        elif header and atoms:
            break
    return atoms


def ca(atoms, chain):
    return np.array([a["xyz"] for a in atoms if a["chain"] == chain and a["name"] == "CA" and not a["het"]])


def wrap(deg):
    return (deg + 180.0) % 360.0 - 180.0


class Frame:
    """A filament frame fitted to the actin subunits of one structure."""

    def __init__(self, atoms, actin_chains):
        cents = {c: ca(atoms, c).mean(axis=0) for c in actin_chains}
        P = np.array(list(cents.values()))
        mean = P.mean(axis=0)
        # Axis direction: principal component of the subunit centroids.
        d = np.linalg.svd(P - mean)[2][0]
        # Polarity: subdomain 2 (the D-loop, residues 40-50) points towards the pointed end.
        dloop = np.array([np.array([a["xyz"] for a in atoms if a["chain"] == c and a["name"] == "CA" and 40 <= a["resi"] <= 50]).mean(axis=0) - cents[c] for c in actin_chains])
        if (dloop @ d).mean() < 0:
            d = -d
        # Axis position: circle fit to the centroids projected on the plane normal to d.
        u = np.cross(d, [1, 0, 0] if abs(d[0]) < 0.9 else [0, 1, 0]); u /= np.linalg.norm(u)
        v = np.cross(d, u)
        Q = np.array([[(p - mean) @ u, (p - mean) @ v] for p in P])
        A = np.c_[2 * Q, np.ones(len(Q))]
        b = (Q ** 2).sum(axis=1)
        cx, cy, _ = np.linalg.lstsq(A, b, rcond=None)[0]
        self.origin = mean + cx * u + cy * v
        self.d, self.u, self.v = d, u, v
        self.cents = cents
        self.radius = float(np.mean([math.hypot(q[0] - cx, q[1] - cy) for q in Q]))

    def cyl(self, p):
        r = p - self.origin
        h = r @ self.d
        x, y = r @ self.u, r @ self.v
        return h, math.degrees(math.atan2(y, x)), math.hypot(x, y)

    def index_and_check(self, ref):
        """Subunit index of every actin relative to `ref`, and the worst deviation from the helix."""
        h0, a0, _ = self.cyl(self.cents[ref])
        out, worst = {}, 0.0
        for c, p in self.cents.items():
            h, a, _ = self.cyl(p)
            n = round((h - h0) / RISE)
            out[c] = n
            worst = max(worst, abs(wrap(a - a0 - n * TWIST)), abs(h - h0 - n * RISE))
        return out, worst

    def to_ref(self, ref, pts):
        """Coordinates in the frame of actin `ref`: X along the axis, its centroid on +Y."""
        h0, a0, _ = self.cyl(self.cents[ref])
        ang = math.radians(a0)
        yhat = math.cos(ang) * self.u + math.sin(ang) * self.v
        zhat = np.cross(self.d, yhat)
        r = pts - (self.origin + h0 * self.d)
        return np.c_[r @ self.d, r @ yhat, r @ zhat]


def strand_offset(frame: Frame, tm_pts, ref):
    """Azimuth of tropomyosin relative to the nearest long-pitch actin strand, and its radius."""
    idx, _ = frame.index_and_check(ref)
    h0, a0, _ = frame.cyl(frame.cents[ref])
    deltas, radii = [], []
    for p in tm_pts:
        h, a, r = frame.cyl(p)
        n = (h - h0) / RISE
        best = None
        for parity in (0, 1):
            # Subunits of one strand: n = parity + 2k. Interpolate the strand azimuth at this height.
            k = (n - parity) / 2
            phi = a0 + (parity + 2 * k) * TWIST + 360 * k  # the strand turns by 2*TWIST+360 per step
            dlt = wrap(a - phi)
            if best is None or abs(dlt) < abs(best):
                best = dlt
        deltas.append(best)
        radii.append(r)
    return float(np.median(deltas)), float(np.median(radii)), float(np.percentile(deltas, 25)), float(np.percentile(deltas, 75))


def main():
    # ---- 8EFI: the actomyosin rigor complex, all heavy atoms ----
    atoms = parse_atoms(fetch("8EFI"))
    actins = ["B", "C", "D", "E", "F"]
    fr = Frame(atoms, actins)
    myo = np.array([a["xyz"] for a in atoms if a["chain"] == "M"])
    ref = min(actins, key=lambda c: np.linalg.norm(fr.cents[c] - myo.mean(axis=0)))
    idx, worst = fr.index_and_check(ref)
    print("8EFI ref actin", ref, "indices", idx, "worst helix deviation", round(worst, 2), "filament radius", round(fr.radius, 1))
    xyz = fr.to_ref(ref, np.array([a["xyz"] for a in atoms]))

    def role_of(a):
        if a["het"]:
            return ROLES["ligand"]
        return ROLES["myosin"] if a["chain"] == "M" else ROLES["tropomyosin"] if a["chain"] in ("O", "P") else ROLES["actin"]

    el = [ELEMENTS.index(a["el"]) if a["el"] in ELEMENTS else len(ELEMENTS) - 1 for a in atoms]
    roles = [role_of(a) for a in atoms]
    sub = [idx.get(a["chain"], 127) for a in atoms]  # actin subunit index, 127 = not actin
    OUT.mkdir(parents=True, exist_ok=True)
    with open(OUT / "actomyosin.bin", "wb") as f:
        f.write(xyz.astype("<f4").tobytes())
        f.write(bytes(el))
        f.write(bytes(roles))
        f.write(struct.pack(f"{len(sub)}b", *sub))

    # Shapes for the molecular level: C-alpha atoms of each domain, in the reference actin's frame.
    # Actin subdomains (standard numbering): SD1 1-32, 70-144, 338-375; SD2 33-69; SD3 145-180, 270-337; SD4 181-269.
    # Myosin motor: roughly N-terminal 1-215, upper 50K 216-465, lower 50K 466-707, converter and lever 708-.
    def domains(chain, ranges):
        cas = [(a["resi"], a["xyz"]) for a in atoms if a["chain"] == chain and a["name"] == "CA"]
        out = []
        for rs in ranges:
            pts = [p for r, p in cas if any(lo <= r <= hi for lo, hi in rs)]
            out.append(np.round(fr.to_ref(ref, np.array(pts)), 1).tolist())
        return out
    actin_domains = domains(ref, [[(1, 32), (70, 144), (338, 375)], [(33, 69)], [(145, 180), (270, 337)], [(181, 269)]])
    myosin_domains = domains("M", [[(1, 215)], [(216, 465)], [(466, 707)], [(708, 900)]])
    print("domain sizes", [len(d) for d in actin_domains], [len(d) for d in myosin_domains])
    tm_open = np.array([a["xyz"] for a in atoms if a["chain"] in ("O", "P") and a["name"] == "CA"])
    d_open = strand_offset(fr, tm_open, ref)

    # ---- 6KN7 / 6KN8: tropomyosin position without and with calcium, and troponin ----
    tn = {}
    offsets = {}
    for pdb in ("6KN7", "6KN8"):
        at = parse_atoms(fetch(pdb))
        chains = list("ABCDEFGHIJKLMNO")
        f2 = Frame(at, chains)
        mid = sorted(chains, key=lambda c: f2.cyl(f2.cents[c])[0])[7]
        _, w = f2.index_and_check(mid)
        tm = np.array([a["xyz"] for a in at if a["chain"] in "PQWXRSYZ" and a["name"] == "CA"])
        offsets[pdb] = strand_offset(f2, tm, mid)
        print(pdb, "worst helix deviation", round(w, 2), "radius", round(f2.radius, 1), "Tm offset/radius", [round(x, 1) for x in offsets[pdb]])
        if pdb == "6KN8":
            # One troponin complex (TnT T, TnI U, TnC V) in the frame of its nearest actin.
            tn_pts = np.array([a["xyz"] for a in at if a["chain"] in ("T", "U", "V") and a["name"] == "CA"])
            near = min(chains, key=lambda c: np.linalg.norm(f2.cents[c] - tn_pts.mean(axis=0)))
            # Long helices in TnT and TnI would give huge convex hulls: cut each chain into 20-residue pieces.
            pieces = []
            for c in ("T", "U", "V"):
                pts = f2.to_ref(near, ca(at, c))
                pieces += [np.round(pts[i:i + 20], 1).tolist() for i in range(0, len(pts), 20) if len(pts[i:i + 20]) >= 4]
            tn = {"ca": pieces}

    print("8EFI Tm offset/radius", [round(x, 1) for x in d_open])
    meta = {
        "sources": {
            "atoms": "8EFI", "tropomyosin_blocked": "6KN7", "tropomyosin_closed": "6KN8", "troponin": "6KN8",
        },
        "rise": RISE, "twist": TWIST,
        "filamentRadius": fr.radius,
        "atomCount": len(atoms),
        "elements": ELEMENTS,
        "roles": list(ROLES),
        "refActin": ref,
        "actinDomains": actin_domains,
        "myosinDomains": myosin_domains,
        # TnT, TnI, TnC (6KN8) in 20-residue pieces, in the frame of the actin nearest to them.
        "troponinChains": tn["ca"],
        # Tropomyosin: azimuth (deg) relative to its long-pitch actin strand, and radius (A).
        "tropomyosin": {
            "blocked": {"offset": offsets["6KN7"][0], "radius": offsets["6KN7"][1]},
            "closed": {"offset": offsets["6KN8"][0], "radius": offsets["6KN8"][1]},
            "open": {"offset": d_open[0], "radius": d_open[1]},
        },
    }
    (OUT / "actomyosin.json").write_text(json.dumps(meta, separators=(",", ":")))
    print("wrote", len(atoms), "atoms")


if __name__ == "__main__":
    main()
