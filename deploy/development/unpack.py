"""Only two regular files, exact names and bounded expansion; never extract a caller path."""
import pathlib
import shutil
import stat
import zipfile

directory = pathlib.Path('.local/deploy')
with zipfile.ZipFile(directory / 'release.zip') as archive:
    entries = archive.infolist()
    if len(entries) != 2 or {entry.filename for entry in entries} != {'image.tar', 'release.json'}:
        raise ValueError('ARTIFACT_LAYOUT_INVALID')
    for entry in entries:
        mode = entry.external_attr >> 16
        if stat.S_ISLNK(mode) or (stat.S_IFMT(mode) and not stat.S_ISREG(mode)):
            raise ValueError('ARTIFACT_TYPE_INVALID')
        if not 0 < entry.file_size <= (8192 if entry.filename == 'release.json' else 800 * 1024 * 1024):
            raise ValueError('ARTIFACT_SIZE_INVALID')
        with archive.open(entry) as source, open(directory / entry.filename, 'xb') as destination:
            shutil.copyfileobj(source, destination, 1024 * 1024)
