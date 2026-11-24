"""Turn a ntscable-style NEURON morphology file (Mainen & Sejnowski 1996, ModelDB 2488, cells/j4a.hoc)
into JSON: sections with their 3-D points (x, y, z, diameter in um) and parent connections.

Run: python tools/neuron/parse_hoc_morphology.py cells/j4a.hoc src/content/neuron-j4a.json
"""
import json, re, sys

text = open(sys.argv[1]).read()
groups = [(m.group(1), int(m.group(2))) for m in re.finditer(r'(dend\d+)\[(\d+)\]', text[text.index('create '):text.index('proc geometry')])]
soma = re.search(r'soma \{\s*nseg = 1\s*diam = ([\d.]+)\s*L = ([\d.]+)', text)
soma_diam, soma_L = float(soma.group(1)), float(soma.group(2))
# The data the hoc code reads with fscan() follow the marker line; numbers only, in order.
data = text[text.index('NEURITE COORDINATES AND DIAMETERS:'):]
data = data[:data.index('printf')]
nums = [float(x) for x in re.findall(r'-?\d+(?:\.\d+)?(?:e-?\d+)?', data.split(':', 1)[1])]
pos = 0
def take():
    global pos
    pos += 1
    return nums[pos - 1]
sections = []
for name, count in groups:
    for i in range(count):
        nseg = int(take()); npts = int(take())
        pts = [[take(), take(), take(), take()] for _ in range(npts)]
        sections.append({'name': f'{name}[{i}]', 'pts': pts, 'parent': 'soma' if i == 0 else None, 'parentX': 0.5 if i == 0 else None})
by = {s['name']: s for s in sections}
for name, count in groups:
    for i in range(1, count):
        p = int(take()); x = take()
        s = by[f'{name}[{i}]']
        s['parent'] = f'{name}[{p}]'; s['parentX'] = x
assert pos == len(nums), (pos, len(nums))
assert all(s['parent'] for s in sections)
json.dump({'source': 'Mainen & Sejnowski 1996, ModelDB 2488, cells/j4a.hoc (layer 5 pyramidal neuron)',
           'soma': {'diam': soma_diam, 'L': soma_L}, 'sections': sections}, open(sys.argv[2], 'w'))
L = sum(sum(((a[0]-b[0])**2+(a[1]-b[1])**2+(a[2]-b[2])**2)**0.5 for a, b in zip(s['pts'], s['pts'][1:])) for s in sections)
print(len(sections), 'sections, total length %.1f um' % L)
