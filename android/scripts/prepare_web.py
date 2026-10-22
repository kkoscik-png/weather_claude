"""Generate the Android snapshot without changing the deployed website."""
from pathlib import Path
import shutil

root = Path(__file__).resolve().parents[2]
source = root / 'dist'
target = root / 'android/app/src/main/assets/www'
shutil.rmtree(target, ignore_errors=True)
shutil.copytree(source, target)
script = target / 'app.js'
text = script.read_text()
registration = "if('serviceWorker' in navigator&&location.protocol==='https:')navigator.serviceWorker.register('/sw.js').catch(e=>console.warn('sw',e.message));"
assert text.count(registration) == 1, 'Review changed PWA setup before packaging'
text = text.replace(registration, '// Android owns the bundled UI; do not install a website service worker.')
script.write_text(text)
(target / 'sw.js').unlink()
icons = root / 'android/app/src/main/res/drawable-nodpi'
icons.mkdir(parents=True, exist_ok=True)
shutil.copyfile(source / 'icons/icon-512.png', icons / 'ic_launcher.png')
print('Packaged the current dist snapshot; API requests stay on weather.seasync.co.')
