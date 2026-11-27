#!/usr/bin/env python3
"""Rebuilds sw.js from tools/sw.template.js with the list of app files and a version made from their contents.
Run it after changing any app file:  python3 tools/stamp.py"""
import hashlib, json, pathlib

root = pathlib.Path(__file__).resolve().parent.parent
names = ['index.html', 'styles.css', 'manifest.webmanifest']
for folder, pattern in (('js', '*.js'), ('icons', '*.png'), ('fonts', '*.woff2')):
    names += sorted(str(p.relative_to(root)).replace('\\', '/') for p in (root / folder).glob(pattern))
digest = hashlib.sha256()
for n in names:
    digest.update(n.encode()); digest.update((root / n).read_bytes())
version = digest.hexdigest()[:12]
files = ['./'] + ['./' + n for n in names]
template = (root / 'tools' / 'sw.template.js').read_text()
out = template.replace("'__VERSION__'", json.dumps(version)).replace('/*__FILES__*/', ', '.join(json.dumps(f) for f in files))
(root / 'sw.js').write_text(out)
print('sw.js stamped', version, len(files), 'files')
