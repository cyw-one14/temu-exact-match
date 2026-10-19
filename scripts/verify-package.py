import base64
import hashlib
import json
from pathlib import Path, PurePosixPath
from zipfile import ZipFile

root = Path(__file__).resolve().parents[1]
version = json.loads((root / 'package.json').read_text(encoding='utf-8'))['version']
archive = root / 'dist' / ('temu-exact-match-' + version + '-windows-x64.zip')
roots = json.loads((root / 'native/extension-files.json').read_text(encoding='utf-8'))

def safe_names(package):
    assert package.testzip() is None, 'ZIP CRC mismatch'
    names = package.namelist()
    assert len(names) == len(set(names)), 'duplicate ZIP entry'
    assert all(not PurePosixPath(n).is_absolute() and '..' not in PurePosixPath(n).parts and '\\' not in n for n in names)
    assert not any(p in {'.cache', '__pycache__', '.git'} or p.startswith(('.env', '.local-')) or p.endswith(('.pem', '.key', '.log', '.pyc')) for n in names for p in PurePosixPath(n).parts)
    return set(names)

def digest_entry(package, name):
    with package.open(name) as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()

with ZipFile(archive) as package:
    names = safe_names(package)
    inventory = json.loads(package.read('native-package.json'))
    assert inventory['version'] == version and inventory['appId'] == 'temu-exact-match-local'
    assert inventory['runtime'] == 'native-local-v1' and inventory['platform'] == 'win32-x64'
    assert names == {'native-package.json'} | {e['path'] for e in inventory['files']}
    for entry in inventory['files']:
        assert package.getinfo(entry['path']).file_size == entry['bytes'], entry['path']
        assert digest_entry(package, entry['path']) == entry['sha256'], entry['path']
    manifest = json.loads(package.read('extension/manifest.json'))
    assert manifest['version'] == version and manifest['manifest_version'] == 3
    assert 'http://127.0.0.1:43187/*' in manifest['host_permissions']
    csp = manifest['content_security_policy']['extension_pages']
    assert "script-src 'self'" in csp and "'unsafe-eval'" not in csp and "'wasm-unsafe-eval'" not in csp
    key_hash = hashlib.sha256(base64.b64decode(manifest['key'])).hexdigest()[:32]
    extension_id = ''.join(chr(97 + int(c, 16)) for c in key_hash)
    assert extension_id == 'ofacjamiaffjahodlncfbcpekooecjno'
    assert {n.removeprefix('extension/') for n in names if n.startswith('extension/')} == set(roots)
    for name in roots:
        assert package.read('extension/' + name) == (root / 'extension' / name).read_bytes(), name
    for name in ['core', 'provider', 'prices', 'listing', 'title-match', 'collection']:
        assert package.read('extension/' + name + '.mjs') == (root / 'shared' / (name + '.mjs')).read_bytes()
    for name in ['feature_worker.py', 'instance_match.py', 'outline_match.py', 'index.mjs', 'subjects.mjs', 'native-runtime.mjs']:
        assert package.read('server/' + name) == (root / 'server' / name).read_bytes()
    for name in ['service-runtime.mjs', 'service-control.mjs', 'service-autostart.mjs', 'service-shortcut.mjs', 'service-watchdog.mjs', 'watchdog-policy.mjs', 'install-local.mjs']:
        assert package.read('scripts/' + name) == (root / 'scripts' / name).read_bytes()
    for entry in json.loads((root / 'native/model-lock.json').read_text(encoding='utf-8'))['files']:
        name = 'runtime/' + entry['path']
        assert package.getinfo(name).file_size == entry['bytes']
        assert digest_entry(package, name) == entry['sha256'], name
    for name in ['runtime/node/node.exe', 'runtime/python/python.exe', 'runtime/python/python313.zip', 'runtime/python/Lib/site-packages/cv2/cv2.pyd', 'Install-TEMU.cmd', 'Start-TEMU.cmd', 'licenses/SOURCES.json']:
        assert name in names, name
    assert not any(n.lower().endswith('vc_redist.x64.exe') for n in names), 'VC runtime downloaded interactively only if required'
    assert 'node_modules/@img/sharp-win32-x64/lib/sharp-win32-x64.node' in names
    assert b'local-engine-client.mjs' in package.read('extension/panel.js')
    assert b'local-engine-client.mjs' in package.read('extension/settings.js')
    assert package.read('native/runtime-lock.json') == (root / 'native/runtime-lock.json').read_bytes()
    assert package.read('native/model-lock.json') == (root / 'native/model-lock.json').read_bytes()
    assert not any(n.startswith('browser/') for n in names), 'retired browser engine must not be shipped'
    assert not any(n.startswith('node_modules/onnxruntime-node/bin/') and not n.startswith('node_modules/onnxruntime-node/bin/napi-v3/win32/x64/') for n in names)
    assert b'studioludens/birefnet-lite-512' in package.read('server/subjects.mjs')
with ZipFile(root / 'dist/temu-exact-match-extension.zip') as light:
    assert safe_names(light) == set(roots)
    for name in roots:
        assert light.read(name) == (root / 'extension' / name).read_bytes()
actual = hashlib.file_digest(archive.open('rb'), 'sha256').hexdigest()
assert (Path(str(archive) + '.sha256').read_text().split()[0]) == actual
print(json.dumps({'zip': 'valid', 'version': version, 'runtime': 'native-local-v1', 'files': len(names), 'bytes': archive.stat().st_size, 'sha256': actual, 'models': 'pinned SHA-256 verified', 'source': 'verified', 'extensionId': extension_id}, ensure_ascii=False))
