"""Build with official SDK tools only; no Gradle dependency downloads needed.

ANDROID_HOME, BALTIC_KEYSTORE and BALTIC_KEY_PASSWORD_FILE must be set.
"""
from pathlib import Path
import os
import subprocess
import zipfile
import xml.etree.ElementTree as ET

root = Path(__file__).resolve().parents[2]
sdk = Path(os.environ['ANDROID_HOME'])
tools = sdk / 'build-tools/35.0.0'
android_jar = sdk / 'platforms/android-35/android.jar'
build = root / 'android/app/build/sdk'
classes = build / 'classes'
classes.mkdir(parents=True, exist_ok=True)
run = lambda args: subprocess.run([str(a) for a in args], check=True)
run(['python3', root / 'android/scripts/prepare_web.py'])
run(['java', '-m', 'jdk.compiler/com.sun.tools.javac.Main', '-source', '17', '-target', '17',
     '-classpath', android_jar, '-d', classes,
     root / 'android/app/src/main/java/co/seasync/baltic/MainActivity.java'])
run([tools / 'd8', '--release', '--min-api', '26', '--lib', android_jar,
     '--output', build, *classes.rglob('*.class')])
ET.register_namespace('android', 'http://schemas.android.com/apk/res/android')
manifest = ET.parse(root / 'android/app/src/main/AndroidManifest.xml')
manifest.getroot().set('package', 'co.seasync.baltic')
manifest.write(build / 'AndroidManifest.xml', encoding='utf-8', xml_declaration=True)
run([tools / 'aapt', 'package', '-f', '-M', build / 'AndroidManifest.xml',
     '-S', root / 'android/app/src/main/res', '-A', root / 'android/app/src/main/assets',
     '-I', android_jar, '--min-sdk-version', '26', '--target-sdk-version', '35',
     '--version-code', '1', '--version-name', '1.0.0', '-F', build / 'unsigned.apk'])
with zipfile.ZipFile(build / 'unsigned.apk', 'a', zipfile.ZIP_DEFLATED) as archive:
    archive.write(build / 'classes.dex', 'classes.dex')
run([tools / 'zipalign', '-f', '-p', '4', build / 'unsigned.apk', build / 'aligned.apk'])
output = build / 'Baltic-1.0.0.apk'
run([tools / 'apksigner', 'sign', '--ks', os.environ['BALTIC_KEYSTORE'],
     '--ks-key-alias', 'baltic', '--ks-pass', 'file:' + os.environ['BALTIC_KEY_PASSWORD_FILE'],
     '--out', output, build / 'aligned.apk'])
run([tools / 'apksigner', 'verify', '--verbose', output])
print(output)
