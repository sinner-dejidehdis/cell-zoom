"""Convert a CellML 1.0 model (no imports) to Python / TypeScript code."""
import sys, re, xml.etree.ElementTree as ET
C='{http://www.cellml.org/cellml/1.0#}'; M='{http://www.w3.org/1998/Math/MathML}'
JS=len(sys.argv)>3 and sys.argv[3]=='js'
root=ET.parse(sys.argv[1]).getroot()
comps={c.get('name'):c for c in root.findall(C+'component')}
units={}; init={}; parent={}
def find(x):
    while parent.get(x,x)!=x: x=parent[x]
    return x
for cn,c in comps.items():
    for v in c.findall(C+'variable'):
        k=f'{cn}.{v.get("name")}'; parent[k]=k; units[k]=v.get('units')
        if v.get('initial_value') is not None: init[k]=v.get('initial_value')
mism=[]
for con in root.findall(C+'connection'):
    mc=con.find(C+'map_components'); a,b=mc.get('component_1'),mc.get('component_2')
    for mv in con.findall(C+'map_variables'):
        x=f'{a}.{mv.get("variable_1")}'; y=f'{b}.{mv.get("variable_2")}'
        if units[x]!=units[y]: mism.append((x,units[x],y,units[y]))
        rx,ry=find(x),find(y)
        if rx!=ry: parent[ry]=rx
print('unit mismatches:',mism,file=sys.stderr)
def canon(k): return find(k)
def name(k): return canon(k).replace('.','__')
def ex(e,cn):
    t=e.tag.replace(M,'')
    if t=='ci': return name(f'{cn}.{e.text.strip()}')
    if t=='cn':
        s=e.text.strip()
        if e.get('type')=='e-notation':
            parts=[x.strip() for x in e.itertext() if x.strip()]; return f'({parts[0]}e{parts[1]})'
        return f'({s})'
    if t=='pi': return 'Math.PI' if JS else 'PI'
    if t=='exponentiale': return 'E'
    if t=='piecewise':
        out='None'
        ow=e.find(M+'otherwise')
        out=ex(ow[0],cn) if ow is not None else '0'
        for p in reversed(e.findall(M+'piece')): out=(f'(({ex(p[1],cn)}) ? ({ex(p[0],cn)}) : ({out}))' if JS else f'(({ex(p[0],cn)}) if ({ex(p[1],cn)}) else ({out}))')
        return out
    if t=='apply':
        op=e[0].tag.replace(M,''); args=[ex(a,cn) for a in e[1:] if a.tag.replace(M,'') not in('bvar','degree')]
        bin={'plus':'+','times':'*','divide':'/','minus':'-','and':(' && ' if JS else ' and '),'or':(' || ' if JS else ' or '),'geq':'>=','leq':'<=','lt':'<','gt':'>','eq':'=='}
        if op=='minus' and len(args)==1: return f'(-{args[0]})'
        if op in bin: return '('+bin[op].join(args)+')'
        if op=='power': return f'(({args[0]})**({args[1]}))'
        if op in('exp','ln','sqrt','abs','floor','tanh','sin','cos'): return f'{"Math." if JS else ""}{ {"ln":"log"}.get(op,op)}({args[0]})'
        if op=='root': return f'sqrt({args[0]})'
        raise Exception(op)
    raise Exception(t)
odes={}; alg={}
for cn,c in comps.items():
    for m in c.findall(M+'math'):
        for eq in m.findall(M+'apply'):
            lhs,rhs=eq[1],eq[2]
            if lhs.tag==M+'apply' and lhs[0].tag==M+'diff':
                odes[canon(f'{cn}.{lhs.find(M+"ci").text.strip()}')]=ex(rhs,cn)
            else: alg[canon(f'{cn}.{lhs.text.strip()}')]=ex(rhs,cn)
states=list(odes)
time=[k for k in parent if k.endswith('.time')][0]; tname=name(time)
consts={k:init[k] for k in init if canon(k)==k and k not in odes and k not in alg}
# topo sort algebraics
order=[]; seen=set()
def dep(expr): return set(re.findall(r'[A-Za-z_][A-Za-z0-9_]*__[A-Za-z0-9_]+',expr))
amap={name(k):k for k in alg}
def visit(n,stack=()):
    if n in seen: return
    if n in stack: raise Exception('cycle '+n)
    for d in dep(alg[amap[n]]):
        if d in amap: visit(d,stack+(n,))
    seen.add(n); order.append(n)
for n in amap: visit(n)
import json
json.dump({'states':[[name(s),init.get(s)] for s in states],'consts':{name(k):v for k,v in consts.items()},
  'alg':[[n,alg[amap[n]]] for n in order],'odes':[[name(s),odes[s]] for s in states],'time':tname},open(sys.argv[2],'w'),indent=1)
print(len(states),'states',len(consts),'consts',len(order),'alg',file=sys.stderr)
