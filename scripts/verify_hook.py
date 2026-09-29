"""Check the installed Steam build without modifying Steam's files."""
import pathlib
import re
import subprocess
import sys
import tempfile

root = pathlib.Path(__file__).resolve().parents[1]
steamui = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else pathlib.Path.home() / '.local/share/Steam/steamui'
lua = (root / 'backend/main.lua').read_text()
find = re.search(r'find = \[\[(.*?)\]\]', lua).group(1)
match = re.search(r'match = \[\[(.*?)\]\]', lua).group(1)
replace = re.search(r'replace = \[\[(.*?)\]\]', lua).group(1).replace('#{{self}}', 'window.__familyPluginTest')
matches = []
for path in steamui.glob('chunk~*.js'):
    source = path.read_text()
    targets = list(re.finditer(find, source))
    if not targets:
        continue
    assert len(targets) == 1, f'Ambiguous hook in {path.name}'
    target = targets[0]
    assert len(target.group()) < 5000, 'Hook matched outside the expected component'
    patched, count = re.subn(match, replace, target.group())
    assert count == 1 and 'ownerBadge?.render' in patched
    result = source[:target.start()] + patched + source[target.end():]
    with tempfile.NamedTemporaryFile(suffix='.js') as temporary:
        temporary.write(result.encode())
        temporary.flush()
        subprocess.run(['node', '--check', temporary.name], check=True)
    matches.append(path.name)
assert len(matches) == 1, f'Expected one Steam family-label component, found {len(matches)}'
print(f'Owner hook matches one component and preserves JavaScript syntax: {matches[0]}')
