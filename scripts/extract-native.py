"""Extract verified build-time runtimes. Never follows links or ZIP traversal."""
from pathlib import Path, PurePosixPath
from zipfile import ZipFile
import stat
import sys

archive, destination, mode = sys.argv[1:]
target = Path(destination).resolve()
target.mkdir(parents=True, exist_ok=True)
with ZipFile(archive) as package:
    for row in package.infolist():
        name = PurePosixPath(row.filename)
        if name.is_absolute() or '..' in name.parts or '\\' in row.filename:
            raise ValueError('unsafe archive path')
        if stat.S_ISLNK(row.external_attr >> 16):
            raise ValueError('archive links are not allowed')
        if mode == 'node':
            if len(name.parts) != 2 or name.name not in {'node.exe', 'LICENSE'}:
                continue
            name = PurePosixPath(name.name)
        path = target.joinpath(*name.parts).resolve()
        if target not in path.parents and path != target:
            raise ValueError('archive path escaped destination')
        if row.is_dir():
            path.mkdir(parents=True, exist_ok=True)
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            with package.open(row) as source, path.open('wb') as output:
                __import__('shutil').copyfileobj(source, output)
