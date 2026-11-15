"""Build the compact structure files the site loads for human ATP synthase.

Source: RCSB PDB entry 8H9S (human ATP synthase, cryo-EM, 2.53 A).
Run:  python3 tools/pdb/build_atp_synthase.py
Writes public/data/atp-synthase.bin, atp-synthase.json and atp-synthase-site.json.

Only the Python standard library is used, so the build is reproducible anywhere.
"""

import gzip
import json
import math
import struct
import urllib.request
from pathlib import Path

PDB_ID = "8H9S"
ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / "tools" / "pdb" / "cache"
OUT = ROOT / "public" / "data"

# Subunit roles, from the entity descriptions of 8H9S on RCSB.
ROTOR_CHAINS = {"1", "2", "3", "4", "5", "6", "7", "8", "G", "H", "I"}  # c-ring, gamma, delta, epsilon
INHIBITOR_CHAINS = {"J"}  # IF1, the natural inhibitor protein bound in this structure
SUBUNIT_NAMES = {
    "A": "alpha", "B": "alpha", "C": "alpha",
    "D": "beta", "E": "beta", "F": "beta",
    "G": "gamma", "H": "delta", "I": "epsilon", "J": "IF1",
    "K": "b", "L": "F6", "M": "d", "N": "a", "O": "OSCP",
    "P": "ATP5MJ", "Q": "A6L", "R": "f", "S": "g", "T": "e",
    **{c: "c" for c in "12345678"},
}
# Catalytic site shown at the atom level: the ADP bound to beta subunit D.
SITE_CHAIN = "D"
SITE_LIGANDS = {"ADP", "MG"}
SITE_RADIUS = 5.0  # angstrom; residues with any atom this close to the ligand are shown

GROUP = {"stator": 0, "rotor": 1, "inhibitor": 2, "ligand": 3}

COVALENT_RADIUS = {"H": 0.31, "C": 0.76, "N": 0.71, "O": 0.66, "S": 1.05, "P": 1.07, "MG": 1.41}


def fetch() -> list[str]:
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / f"{PDB_ID}.cif.gz"
    if not path.exists():
        url = f"https://files.rcsb.org/download/{PDB_ID}.cif.gz"
        urllib.request.urlretrieve(url, path)
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
            if f.get("label_alt_id", ".") not in (".", "A"):
                continue
            atoms.append({
                "het": f["group_PDB"] == "HETATM",
                "el": f["type_symbol"].upper(),
                "name": f["label_atom_id"].strip('"'),
                "resn": f["label_comp_id"],
                "resi": f["auth_seq_id"],
                "chain": f["auth_asym_id"],
                "xyz": (float(f["Cartn_x"]), float(f["Cartn_y"]), float(f["Cartn_z"])),
            })
        elif header and atoms:
            break
    return atoms


def centroid(points):
    n = len(points)
    return tuple(sum(p[i] for p in points) / n for i in range(3))


def sub(a, b):
    return tuple(a[i] - b[i] for i in range(3))


def norm(v):
    length = math.sqrt(sum(x * x for x in v))
    return tuple(x / length for x in v)


def role(atom) -> str:
    if atom["het"] and atom["resn"] in {"ATP", "ADP", "MG"}:
        return "ligand"
    if atom["chain"] in INHIBITOR_CHAINS:
        return "inhibitor"
    if atom["chain"] in ROTOR_CHAINS:
        return "rotor"
    return "stator"


def main() -> None:
    atoms = parse_atoms(fetch())
    center = centroid([a["xyz"] for a in atoms])

    # Rotation axis: through the c-ring centre and the alpha3beta3 head centre.
    # The central stalk (gamma) runs along this line, so it is a good estimate of the real axis.
    cring = centroid([a["xyz"] for a in atoms if a["chain"] in set("12345678")])
    head = centroid([a["xyz"] for a in atoms if a["chain"] in set("ABCDEF") and not a["het"]])
    axis_dir = norm(sub(head, cring))

    elements = sorted({a["el"] for a in atoms})
    chains = sorted({a["chain"] for a in atoms})

    buf = bytearray()
    for a in atoms:
        buf += struct.pack("<3f", *sub(a["xyz"], center))
    for a in atoms:
        buf += struct.pack("<B", elements.index(a["el"]))
    for a in atoms:
        buf += struct.pack("<B", chains.index(a["chain"]))
    for a in atoms:
        buf += struct.pack("<B", GROUP[role(a)])

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "atp-synthase.bin").write_bytes(bytes(buf))
    meta = {
        "pdbId": PDB_ID,
        "atomCount": len(atoms),
        "units": "angstrom",
        "elements": elements,
        "chains": [{"id": c, "subunit": SUBUNIT_NAMES.get(c, "?")} for c in chains],
        "groups": GROUP,
        "site": {"chain": SITE_CHAIN, "position": [round(x, 3) for x in sub(centroid([a["xyz"] for a in atoms if a["chain"] == SITE_CHAIN and a["het"] and a["resn"] in SITE_LIGANDS]), center)]},
        "axis": {"origin": [round(x, 3) for x in sub(cring, center)], "direction": [round(x, 5) for x in axis_dir]},
    }
    (OUT / "atp-synthase.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1))

    # Atom-level view of one catalytic site.
    lig = [a for a in atoms if a["chain"] == SITE_CHAIN and a["het"] and a["resn"] in SITE_LIGANDS]
    near_res = set()
    for a in atoms:
        if a["het"]:
            continue
        if any(math.dist(a["xyz"], l["xyz"]) <= SITE_RADIUS for l in lig):
            near_res.add((a["chain"], a["resi"]))
    site = lig + [a for a in atoms if not a["het"] and (a["chain"], a["resi"]) in near_res]
    site_center = centroid([l["xyz"] for l in lig])
    bonds = []
    for i in range(len(site)):
        for j in range(i + 1, len(site)):
            ai, aj = site[i], site[j]
            if "MG" in (ai["el"], aj["el"]):
                continue  # Mg2+ is coordinated, not covalently bonded
            limit = COVALENT_RADIUS.get(ai["el"], 0.8) + COVALENT_RADIUS.get(aj["el"], 0.8) + 0.45
            if math.dist(ai["xyz"], aj["xyz"]) <= limit:
                bonds.append([i, j])
    residues = sorted({(a["chain"], a["resn"], a["resi"]) for a in site if not a["het"]}, key=lambda r: (r[0], int(r[2])))
    (OUT / "atp-synthase-site.json").write_text(json.dumps({
        "pdbId": PDB_ID,
        "chain": SITE_CHAIN,
        "ligands": sorted(SITE_LIGANDS),
        "radius": SITE_RADIUS,
        "atoms": [{
            "el": a["el"], "name": a["name"], "resn": a["resn"], "resi": a["resi"], "chain": a["chain"],
            "ligand": a["het"], "xyz": [round(x, 3) for x in sub(a["xyz"], site_center)],
        } for a in site],
        "bonds": bonds,
        "residues": [{"chain": c, "resn": n, "resi": i} for c, n, i in residues],
    }, ensure_ascii=False))

    print(f"{len(atoms)} atoms, {len(elements)} elements, {len(chains)} chains; site: {len(site)} atoms, {len(bonds)} bonds, {len(residues)} residues")


if __name__ == "__main__":
    main()
