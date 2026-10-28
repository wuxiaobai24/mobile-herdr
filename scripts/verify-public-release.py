import hashlib, json, os, shutil, subprocess, tarfile, tempfile
from pathlib import Path
version = json.loads(Path('package.json').read_text())['version']
base = f'https://github.com/wuxiaobai24/mobile-herdr/releases/download/v{version}/'
source = subprocess.check_output(['git', 'rev-parse', f'v{version}^{{commit}}'], text=True).strip()
asset_dir = Path('artifacts/releases')
checks = []
env = dict(os.environ)
for name in ['GH_TOKEN', 'GITHUB_TOKEN']:
    env.pop(name, None)
def run(args, **kwargs):
    return subprocess.check_output(args, env=env, text=True, **kwargs).strip()
with tempfile.TemporaryDirectory(prefix='mh-public-release-') as directory:
    root = Path(directory)
    for name in [f'mobile-herdr-{version}.tar.gz', f'mobile-herdr-{version}.tar.gz.sha256', f'mobile-herdr-{version}.apk.sha256', 'install.sh']:
        run(['curl', '-q', '-fsSL', '--retry', '3', '--output', str(root / name), base + name])
    run(['curl', '-q', '-fsSL', '--retry', '3', '--output', str(root / 'release.json'), f'https://api.github.com/repos/wuxiaobai24/mobile-herdr/releases/tags/v{version}'])
    release = json.loads((root / 'release.json').read_text())
    assert release['prerelease'] is True and release['draft'] is False
    assets = {a['name']: a for a in release['assets']}
    for name, asset in assets.items():
        local = Path('install.sh') if name == 'install.sh' else asset_dir / name
        assert local.is_file() and asset['state'] == 'uploaded'
        assert asset['digest'] == 'sha256:' + hashlib.sha256(local.read_bytes()).hexdigest()
    assert len(assets) == 7
    checks.append('seven public assets have server SHA-256 digests matching the tested local bytes')
    response = run(['curl', '-q', '-fsSL', '--retry', '3', '--range', '0-1023', '--max-filesize', '4096', '--output', str(root / 'apk-prefix'), '--write-out', '%{http_code}', base + f'mobile-herdr-{version}.apk'])
    assert response == '206' and (root / 'apk-prefix').read_bytes().startswith(b'PK')
    checks.append('APK supports anonymous range download')
    for suffix in ['tar.gz', 'apk']:
        name = f'mobile-herdr-{version}.{suffix}'
        local = root / name if suffix == 'tar.gz' else asset_dir / name
        digest = hashlib.sha256(local.read_bytes()).hexdigest()
        assert (root / (name + '.sha256')).read_text().strip() == f'{digest}  {name}'
        assert digest == hashlib.sha256((asset_dir / name).read_bytes()).hexdigest()
    checks.append('downloaded archive matches tested bytes; both public checksum files match verified assets')
    with tarfile.open(root / f'mobile-herdr-{version}.tar.gz') as archive:
        manifest = json.load(archive.extractfile(f'mobile-herdr-{version}/release.json'))
        assert manifest['version'] == version and manifest['sourceCommit'] == source and manifest['sourceDirty'] is False
    checks.append('public archive identifies the clean tagged source commit')
    assert (root / 'install.sh').read_bytes() == Path('install.sh').read_bytes()
    env['MOBILE_HERDR_STATE'] = str(root / 'state')
    env['MOBILE_HERDR_BUN'] = shutil.which('bun')
    run(['bash', str(root / 'install.sh'), '--prefix', str(root / 'runtime'), '--bin-dir', str(root / 'bin'), '--no-install-bun'])
    for command in ['mobile-herdr', 'mherdr']:
        assert run([str(root / 'bin' / command), '--version']) == version
    checks.append('anonymous installer selects the tagged version and installs both launchers in isolated directories')
report = {'version': version, 'sourceCommit': source, 'checks': checks}
(asset_dir / f'{version}-public-verification.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
