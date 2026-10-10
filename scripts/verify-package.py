import json
from pathlib import Path
from zipfile import ZipFile

root = Path(__file__).resolve().parents[1]
archive = root / 'dist' / 'temu-exact-match-extension.zip'
with ZipFile(archive) as package:
    assert package.testzip() is None
    names = set(package.namelist())
    manifest = json.loads(package.read('manifest.json'))
    assert manifest['manifest_version'] == 3
    assert manifest['side_panel']['default_path'] in names
    assert manifest['background']['service_worker'] in names
    assert all(name in names for name in manifest['icons'].values())
    assert all(name in names for script in manifest.get('content_scripts', []) for name in script.get('js', []))
    assert manifest['version'] == json.loads((root / 'package.json').read_text(encoding='utf-8'))['version']
    assert package.read('core.mjs') == (root / 'shared' / 'core.mjs').read_bytes()
    assert package.read('provider.mjs') == (root / 'shared' / 'provider.mjs').read_bytes()
    assert package.read('prices.mjs') == (root / 'shared' / 'prices.mjs').read_bytes()
    assert package.read('listing.mjs') == (root / 'shared' / 'listing.mjs').read_bytes()
    assert package.read('title-match.mjs') == (root / 'shared' / 'title-match.mjs').read_bytes()
    assert package.read('collection.mjs') == (root / 'shared' / 'collection.mjs').read_bytes()
    assert not any('config' in name or 'model' in name for name in names)
    assert all(not name.startswith('/') and '..' not in name for name in names)
    print(json.dumps({'zip': 'valid', 'files': len(names), 'bytes': archive.stat().st_size,
                      'manifest': 'MV3', 'secrets': 'not included'}, ensure_ascii=False))
