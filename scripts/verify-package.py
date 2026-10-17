import hashlib
import json
from pathlib import Path, PurePosixPath
from zipfile import ZipFile

root = Path(__file__).resolve().parents[1]
archive = root / 'dist' / 'temu-exact-match-extension.zip'
with ZipFile(archive) as package:
    assert package.testzip() is None
    names = package.namelist()
    assert len(names) == len(set(names)), 'duplicate ZIP entries'
    assert all(not PurePosixPath(name).is_absolute() and '..' not in PurePosixPath(name).parts and '\\' not in name for name in names)
    manifest = json.loads(package.read('manifest.json'))
    assets = json.loads(package.read('browser-assets.json'))
    roots = json.loads((root / 'browser' / 'package-files.json').read_text(encoding='utf-8'))
    assert set(names) == set(roots) | {entry['path'] for entry in assets['files']}
    assert manifest['manifest_version'] == 3
    assert manifest['version'] == json.loads((root / 'package.json').read_text(encoding='utf-8'))['version']
    assert manifest['side_panel']['default_path'] in names
    assert manifest['background']['service_worker'] in names
    assert all(name in names for name in manifest['icons'].values())
    assert all(name in names for script in manifest.get('content_scripts', []) for name in script.get('js', []))
    assert "'wasm-unsafe-eval'" in manifest['content_security_policy']['extension_pages']
    assert "'unsafe-eval'" not in manifest['content_security_policy']['extension_pages']
    assert '127.0.0.1' not in json.dumps(manifest)
    key_hash = hashlib.sha256(__import__('base64').b64decode(manifest['key'])).hexdigest()[:32]
    extension_id = ''.join(chr(97 + int(char, 16)) for char in key_hash)
    assert extension_id == 'ofacjamiaffjahodlncfbcpekooecjno'
    for name in ['core', 'provider', 'prices', 'listing', 'title-match', 'collection']:
        assert package.read(name + '.mjs') == (root / 'shared' / (name + '.mjs')).read_bytes()
    for name in ['feature_worker.py', 'instance_match.py', 'outline_match.py']:
        assert package.read('python/' + name) == (root / 'server' / name).read_bytes()
    assert package.read('python/feature_bridge.py') == (root / 'browser' / 'feature_bridge.py').read_bytes()
    for entry in assets['files']:
        assert package.getinfo(entry['path']).file_size == entry['bytes']
        with package.open(entry['path']) as stream:
            assert hashlib.file_digest(stream, 'sha256').hexdigest() == entry['sha256'], entry['path']
    model_lock = json.loads((root / 'browser' / 'model-lock.json').read_text(encoding='utf-8'))
    assert assets['models'] == model_lock['files']
    for name in ['panel.js', 'settings.js', 'engine-client.mjs', 'engine-worker.js']:
        assert b'127.0.0.1' not in package.read(name)
    assert not any(part in {'.cache', 'node_modules', '__pycache__'} or part.startswith('.env') or part.endswith(('.pem', '.key', '.log')) for name in names for part in PurePosixPath(name).parts)
    print(json.dumps({'zip': 'valid', 'version': manifest['version'], 'runtime': assets['runtime'], 'files': len(names), 'bytes': archive.stat().st_size, 'models': 'pinned SHA-256 verified', 'python': 'source parity verified', 'extensionId': extension_id, 'localhost': 'not required'}, ensure_ascii=False))
