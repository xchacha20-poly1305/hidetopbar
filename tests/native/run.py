"""Run touch regressions in an isolated, headless GNOME Shell 51 session."""
import os
import shutil
import signal
import subprocess
import tempfile
from pathlib import Path

repo = Path(__file__).resolve().parents[2]
run_dir = Path(tempfile.mkdtemp(prefix='hidetopbar-native-'))
extension = run_dir / 'data/gnome-shell/extensions/hidetopbar@io.github.xchacha20-poly1305'
extension.mkdir(parents=True)
for source in repo.glob('*.js'):
    shutil.copy2(source, extension / source.name)
for name in ['metadata.json', 'Settings.ui']:
    shutil.copy2(repo / name, extension / name)
shutil.copytree(repo / 'schemas', extension / 'schemas')
subprocess.run(['glib-compile-schemas', '--strict', str(extension / 'schemas')], check=True)
shutil.copy2(repo / 'tests/native/extension.js', extension / 'extension.js')

env = dict(os.environ)
env.update({
    'XDG_DATA_HOME': str(run_dir / 'data'),
    'XDG_CONFIG_HOME': str(run_dir / 'config'),
    'XDG_CACHE_HOME': str(run_dir / 'cache'),
    'HIDETOPBAR_TEST_RESULT': str(run_dir / 'result'),
    'HIDETOPBAR_CLICK_RESULT': str(run_dir / 'clicked'),
    'HIDETOPBAR_TEST_CLIENT': str(repo / 'tests/native/client.py'),
})
command = """
set -e
gsettings set org.gnome.shell enabled-extensions "['hidetopbar@io.github.xchacha20-poly1305']"
gsettings set org.gnome.shell welcome-dialog-last-shown-version '999'
exec gnome-shell --headless --wayland --no-x11 --virtual-monitor 1024x768
"""
with (run_dir / 'shell.log').open('w') as log:
    process = subprocess.Popen(['dbus-run-session', '--', 'bash', '-c', command],
                               env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    try:
        return_code = process.wait(timeout=180)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGTERM)
        process.wait(timeout=10)
        raise
result = (run_dir / 'result').read_text() if (run_dir / 'result').exists() else 'FAIL Shell terminated before reporting results'
print(result)
print(f'GNOME log saved at {run_dir / "shell.log"}')
raise SystemExit(0 if result == 'PASS' and return_code == 0 else 1)
