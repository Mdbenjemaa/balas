"""Assemble l'aperçu publiable sur claude.ai dans app/dist-preview :
données regroupées en paquets, carte PMTiles découpée en morceaux, polices en JSON."""
import base64, json, os, shutil, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
APP = HERE.parent / 'app'
SRC = APP / 'public'
OUT = APP / 'dist-preview'
EXT = os.environ.get('CHUNK_EXT', 'json')       # 'json' (base64) : l'hébergeur des pages claude.ai refuse .bin
CHUNK = 1 << 20

def dump(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')

data = OUT / 'data'
shutil.rmtree(data, ignore_errors=True)
shutil.rmtree(OUT / 'fonts', ignore_errors=True)

for name in ('manifest.json', 'gares.json'):
    shutil.copy(SRC / 'data' / name, data / name) if data.exists() else (data.mkdir(parents=True), shutil.copy(SRC / 'data' / name, data / name))
for name in ('land.json', 'cities.json'):
    (data / 'base').mkdir(parents=True, exist_ok=True)
    shutil.copy(HERE / name, data / 'base' / name)
for icon in ('icon-192.png', 'apple-touch-icon.png'):
    shutil.copy(SRC / icon, OUT / icon)

# Cases : un paquet par degré carré (4 x 4 cases de 0,25°).
index = {'c': {}, 'l': {}}
groups = {}
for f in sorted((SRC / 'data' / 'cells').glob('*.json')):
    x, y = map(int, f.stem.split('_'))
    groups.setdefault((x // 4, y // 4), {})[f.stem] = json.loads(f.read_text())
for n, (_, cells) in enumerate(sorted(groups.items())):
    for k in cells:
        index['c'][k] = n
    dump(data / 'packs' / f'c{n}.json', cells)

# Fiches de ligne : paquets d'environ 300 Ko.
pack, size, n = {}, 0, 0
for f in sorted((SRC / 'data' / 'lines').glob('*.json')):
    pack[f.stem] = json.loads(f.read_text()); index['l'][f.stem] = n; size += f.stat().st_size
    if size > 300_000:
        dump(data / 'packs' / f'l{n}.json', pack); pack, size, n = {}, 0, n + 1
if pack:
    dump(data / 'packs' / f'l{n}.json', pack)
dump(data / 'packs' / 'index.json', index)

# Carte des voies découpée.
raw = (SRC / 'data' / 'rail.pmtiles').read_bytes()
for i in range(0, len(raw), CHUNK):
    part = raw[i:i + CHUNK]
    p = data / 'rail' / f'{i // CHUNK:03d}.{EXT}'
    p.parent.mkdir(parents=True, exist_ok=True)
    if EXT == 'json':
        dump(p, {'b64': base64.b64encode(part).decode()})
    else:
        p.write_bytes(part)
dump(data / 'rail' / 'meta.json', {'size': len(raw), 'chunk': CHUNK, 'ext': EXT, 'b64': EXT == 'json'})

# Polices.
for f in (SRC / 'fonts').rglob('*.pbf'):
    dump(OUT / 'fonts' / f.parent.name.replace(' ', '_') / f'{f.stem}.json', {'b64': base64.b64encode(f.read_bytes()).decode()})

files = [p for p in OUT.rglob('*') if p.is_file()]
print(f'{len(files)} fichiers, {sum(p.stat().st_size for p in files) / 1e6:.1f} Mo, plus gros {max(p.stat().st_size for p in files) / 1e6:.1f} Mo')
