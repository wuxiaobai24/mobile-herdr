"""Standalone release APK checks on a dedicated emulator and isolated Unix socket fixture."""
import base64
import json
import os
import subprocess
import time
import urllib.request
from pathlib import Path
import uiautomator2 as u2
from uiautomator2.exceptions import UiObjectNotFoundError

serial = os.environ['MOBILE_HERDR_ANDROID_SERIAL']
package = 'dev.mobileherdr.app'
output = Path(os.environ.get('MOBILE_HERDR_ANDROID_OUTPUT', 'artifacts/android/ui'))
output.mkdir(parents=True, exist_ok=True)
checks = []

def adb(*args):
    return subprocess.run(['adb', '-s', serial, *args], check=True, capture_output=True).stdout.decode().strip()

def inspect(path='/state'):
    with urllib.request.urlopen(os.environ['MOBILE_HERDR_TEST_INSPECTOR'] + path, timeout=10) as response:
        return json.load(response)

def until(predicate, timeout=25):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(.2)
    raise AssertionError('Expected Android state did not arrive')

def check(name, condition=True):
    assert condition, name
    checks.append(name)
    print('PASS:', name, flush=True)

def click(label):
    stable_click(d(description=label), label)

def stable_click(selector, label):
    assert selector.wait(timeout=20), label
    previous, stable = None, 0
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        try:
            bounds = selector.info.get('bounds')
        except UiObjectNotFoundError:
            previous, stable = None, 0
            time.sleep(.15)
            continue
        stable = stable + 1 if bounds == previous else 0
        if stable >= 2:
            break
        previous = bounds
        time.sleep(.15)
    selector.click(timeout=20)

def shot(name):
    previous, stable = '', 0
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        current = d.dump_hierarchy()
        stable = stable + 1 if current == previous else 0
        if stable >= 2:
            break
        previous = current
        time.sleep(.2)
    d.screenshot(str(output / name))

def go_latest():
    for label in ['回到最新消息', '查看新消息']:
        if d(description=label).exists:
            click(label)
            return

def show_details():
    click('更多会话操作')
    click('原生连接详情')

def hide_keyboard():
    # Android handles the first Back press by dismissing the IME.
    if 'mInputShown=true' in adb('shell', 'dumpsys', 'input_method'):
        d.press('back')

def web_click(label):
    quoted = json.dumps(label, ensure_ascii=False)
    d.xpath(f'//*[@text={quoted} or @content-desc={quoted}]').click(timeout=20)

def web_exists(label):
    quoted = json.dumps(label, ensure_ascii=False)
    return d.xpath(f'//*[@text={quoted} or @content-desc={quoted}]').exists

payload = base64.urlsafe_b64encode(json.dumps({'version': 1, 'url': os.environ['MOBILE_HERDR_TEST_URL'], 'token': os.environ['MOBILE_HERDR_TEST_TOKEN'], 'name': 'Android test bridge'}).encode()).decode().rstrip('=')
link = 'mobile-herdr://pair#connect=' + payload
try:
    adb('install', '-r', os.environ['MOBILE_HERDR_ANDROID_APK'])
    d = u2.connect(serial)
    d.settings['wait_timeout'] = 20
    d.app_clear(package)
    d.app_start(package)
    assert d(description='扫描配对二维码').wait(timeout=30)
    shot('connect.png')
    check('release APK starts without Metro and exposes native pairing')
    click('扫描配对二维码')
    d(resourceIdMatches='.*:id/permission_deny_button').click(timeout=15)
    assert d(textContains='相机权限未开启').wait(timeout=15)
    check('camera permission denial keeps manual pairing available')
    # Capture am output: Android echoes the credential handoff URI, so never print it.
    adb('shell', 'am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', link, package)
    until(lambda: d(description='Bridge 地址').get_text() == os.environ['MOBILE_HERDR_TEST_URL'])
    check('warm deep link imports existing CLI payload into confirmation form')
    click('连接开发机')
    until(lambda: d(description='发给原会话的消息').exists)
    shot('chat.png')
    check('Android connects to the exact fixture session and pane')
    if os.environ.get('MOBILE_HERDR_ANDROID_FILES_ONLY') != '1':
        click('更多会话操作')
        click('查找与历史')
        d(description='查找当前对话').set_text('Android reading question')
        until(lambda: d(text='Android reading question').exists)
        shot('reading-search.png')
        check('native Markdown and search locate the original user message')
        click('关闭对话查找')
        if d(description='回到最新消息').exists:
            click('回到最新消息')
        click('在手机继续')
        until(lambda: inspect()['owner'] != 'desktop')
        check('native takeover uses the same registered runtime')
        editor = d(description='发给原会话的消息')
        click('会话快捷选项'); click('选择会话模型'); click('使用模型 Fixture Fast')
        until(lambda: inspect()['model'] == 'fixture-fast')
        check('native model picker changes the current provider with one selection')
        click('会话快捷选项'); click('选择会话模型'); click('使用模型 Fixture Model')
        until(lambda: inspect()['model'] == 'fixture-model')
        click('会话快捷选项'); click('选择思考强度'); click('使用思考强度 high')
        until(lambda: inspect()['effort'] == 'high')
        check('native reasoning picker applies an advertised model capability')
        editor.set_text('/plan'); click('发送消息')
        until(lambda: inspect().get('mode') == 'plan')
        until(lambda: editor.get_text() in ['', '继续交给 agent…'])
        check('native slash selects planning mode without creating a conversation')
        click('会话快捷选项'); click('命令 /editor')
        editor.set_text('Android fullscreen draft\n继续同一个会话')
        hide_keyboard(); shot('fullscreen-draft.png')
        d.press('back')
        until(lambda: d(description='会话快捷选项').exists)
        check('Android Back closes fullscreen editing and keeps its shared draft', editor.get_text() == 'Android fullscreen draft\n继续同一个会话')
        editor.set_text('Android native message')
        until(lambda: d(description='发送消息').exists)
        shot('keyboard.png')
        click('发送消息')
        until(lambda: inspect()['sent'] == 1)
        until(lambda: editor.get_text() in ['', '补充到当前任务…'])
        hide_keyboard()
        go_latest()
        shot('sent.png')
        check('native Android prompt reaches the original agent exactly once')
        editor.set_text('需要审批')
        click('发送消息')
        until(lambda: inspect()['requests'] == 1)
        hide_keyboard()
        go_latest()
        shot('approval.png')
        if not d(description='允许本次操作').exists:
            d(scrollable=True).scroll.to(description='允许本次操作')
        click('允许本次操作')
        until(lambda: inspect()['requests'] == 0)
        check('Android handles structured command approval')
        editor.set_text('需要问题')
        click('发送消息')
        until(lambda: inspect()['requests'] == 1)
        hide_keyboard()
        go_latest()
        d(text='深色').click(timeout=20)
        if not d(description='提交回答').exists:
            d(scrollable=True).scroll.to(description='提交回答')
        click('提交回答')
        until(lambda: inspect()['requests'] == 0)
        check('Android answers a structured provider question')
        editor.set_text('Android durable draft')
        until(lambda: d(text='草稿已保存').exists)
        d.press('home')
        inspect('/reclaim')
        d.app_start(package)
        until(lambda: d(description='发给原会话的消息').exists)
        check('foreground return preserves draft', editor.get_text() == 'Android durable draft')
        until(lambda: d(description='在手机继续').exists)
        show_details()
        shot('desktop-owner.png')
        click('关闭原生连接详情')
        check('foreground return rechecks desktop ownership instead of reclaiming it')
        d.app_stop(package)
        d.app_start(package)
        until(lambda: d(description='发给原会话的消息').exists)
        check('process restart restores SQLite draft and SecureStore machine', editor.get_text() == 'Android durable draft')
        d.app_stop(package)
        adb('install', '-r', os.environ['MOBILE_HERDR_ANDROID_APK'])
        d.app_start(package)
        until(lambda: d(description='发给原会话的消息').exists)
        check('same-signature APK reinstall preserves machine and draft', editor.get_text() == 'Android durable draft')
        inspect('/disconnect')
        until(lambda: d(description='重新连接开发机').exists)
        editor.set_text('Android offline draft')
        hide_keyboard()
        shot('offline.png')
        inspect('/reconnect')
        until(lambda: not d(description='重新连接开发机').exists)
        check('reconnect keeps draft and never replays writes', editor.get_text() == 'Android offline draft' and not inspect()['replayed'])
        click('更多会话操作')
        click('外观设置')
        click('Flexoki Light')
        until(lambda: d(description='Flexoki Light', checked=True).exists)
        shot('appearance-light.png')
        d.press('back')
        check('shared theme controls work in native Android')
        click('打开会话列表')
        assert d(description='搜索会话').exists
        d.press('back')
        check('Android Back closes the session drawer')
        click('终端')
        until(lambda: web_exists('历史'))
        web_click('历史')
        until(lambda: web_exists('返回终端'))
        (output / 'terminal-hierarchy.xml').write_text(d.dump_hierarchy())
        web_click('复制终端历史')
        until(lambda: web_exists('已复制到剪贴板'))
        shot('terminal-history.png')
        web_click('返回终端')
        web_click('打开方向面板')
        until(lambda: web_exists('终端向左'))
        web_click('终端向左')
        until(lambda: '\x1b[D' in inspect()['terminalInput'])
        shot('terminal-directions.png')
        web_click('关闭方向面板')
        web_click('预览终端粘贴')
        until(lambda: d.xpath('//*[contains(@text,"原始终端输出")]').exists)
        before = len(inspect()['terminalInput'])
        shot('terminal-paste.png')
        check('native clipboard is previewed without sending terminal input', len(inspect()['terminalInput']) == before)
        web_click('粘贴到终端')
        until(lambda: any('原始终端输出' in value for value in inspect()['terminalInput']))
        check('Android WebView direction keys and explicit clipboard paste reach the owned VT fixture')
        # Paste focuses xterm. Android can consume the first Back to dismiss its IME.
        for _ in range(2):
            d.press('back')
            if d(description='发给原会话的消息').wait(timeout=3):
                break
        until(lambda: d(description='发给原会话的消息').exists)
        check('native WebView reads terminal history, copies through Android clipboard, and Back returns to chat')
        if d(description='交还电脑').exists:
            click('交还电脑')
        until(lambda: inspect()['owner'] == 'desktop')
    click('更多会话操作'); click('浏览项目文件')
    assert d(description='打开目录 src').wait(timeout=20)
    shot('files.png')
    click('打开目录 src'); click('打开文件 hello.ts')
    assert d(textContains='export const greeting').wait(timeout=20)
    shot('file-preview.png')
    check('native file browser navigates and previews the selected project')
    # This file and emulator are both owned by the test.
    adb('shell', 'rm', '-f', '/sdcard/Download/hello.ts')
    click('下载当前文件')
    until(lambda: 'documentsui' in d.app_current().get('package', ''))
    shot('file-save-picker.png')
    (output / 'file-save-picker.xml').write_text(d.dump_hierarchy())
    hide_keyboard()
    save = d(resourceId='android:id/button1')
    if not save.exists:
        save = d(textMatches='(?i)save')
    assert save.wait(timeout=20), 'Android system Save action'
    stable_click(save, 'Android system Save action')
    until(lambda: d(description='关闭文件浏览').exists)
    assert d(text='文件已交给系统保存。').wait(timeout=20)
    check('native download saves exact bytes through the Android document picker', adb('shell', 'cat', '/sdcard/Download/hello.ts') == 'export const greeting = "你好";')
    adb('shell', 'rm', '-f', '/sdcard/Download/hello.ts')
    click('下载当前文件')
    until(lambda: 'documentsui' in d.app_current().get('package', ''))
    d.press('back')
    assert d(text='已取消保存。').wait(timeout=20)
    check('canceling the Android save picker returns to the same preview')
    click('返回文件目录'); click('返回文件目录')
    chinese_path = "'/sdcard/Download/说明 文档.md'"
    adb('shell', 'rm', '-f', chinese_path)
    click('打开文件 说明 文档.md'); click('下载当前文件')
    until(lambda: 'documentsui' in d.app_current().get('package', ''))
    hide_keyboard()
    stable_click(d(resourceId='android:id/button1'), 'Save Chinese project filename')
    assert d(text='文件已交给系统保存。').wait(timeout=20)
    check('native save preserves Chinese filename, spaces and UTF-8 bytes', adb('shell', 'cat', chinese_path) == '# 手机文件\n\n内容预览 ✓')
    adb('shell', 'rm', '-f', chinese_path)
    click('返回文件目录'); click('打开文件 preview.png')
    assert d(description='图片预览 preview.png').wait(timeout=20)
    width, height = d.window_size()
    until(lambda: all(abs(a-b)<8 for a,b in zip(d.screenshot(format='pillow').getpixel((width//2,height//2))[:3], (30,120,230))))
    shot('file-image.png')
    check('native image preview decodes authenticated project pixels')
    click('关闭文件浏览')
    click('更多会话操作'); click('版本更新')
    assert d(description='下载最新 Android APK').wait(timeout=20)
    shot('update.png')
    check('native update panel separates Bridge updates from APK installation')
    click('关闭版本更新')
    # Cold-link path, after process death, must still ask for confirmation.
    d.app_stop(package)
    adb('shell', 'am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', link, package)
    until(lambda: d(description='Bridge 地址').exists)
    check('cold deep link asks for pairing confirmation')
    d.press('back')
    assert inspect()['owner'] == 'desktop'
    check('test leaves the original runtime under desktop ownership')
except Exception:
    if 'd' in globals():
        shot('failure.png')
        (output / 'failure-hierarchy.xml').write_text(d.dump_hierarchy())
    log = adb('logcat', '-d', '-t', '500', 'ReactNativeJS:E', 'AndroidRuntime:E', '*:S')
    for secret in [link, payload, os.environ['MOBILE_HERDR_TEST_TOKEN']]:
        log = log.replace(secret, '[redacted]')
    (output / 'failure.log').write_text(log)
    raise
finally:
    if 'd' in globals():
        d.app_stop(package)
    (output / 'verification.json').write_text(json.dumps({'checks': checks, 'count': len(checks), 'device': 'Android emulator; not a physical-device test'}, ensure_ascii=False, indent=2))
print(f'Android emulator verification: {len(checks)} checks passed.', flush=True)
