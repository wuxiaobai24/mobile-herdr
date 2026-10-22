"""Exercise the phone UI against an isolated Unix-socket fixture, never the user's agents."""
import json
import os
import time
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

url = os.environ['MOBILE_HERDR_TEST_URL']
token = os.environ['MOBILE_HERDR_TEST_TOKEN']
artifacts = Path('artifacts/ui')
errors = []
checks = []

def check(name, condition):
    assert condition, name
    checks.append(name)

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    context = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=1, is_mobile=True, has_touch=True)
    page = context.new_page()
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('console', lambda message: errors.append(message.text) if message.type == 'error' and 'Failed to load resource' not in message.text else None)
    page.goto(url)
    page.wait_for_load_state('networkidle')
    page.get_by_label('连接密钥', exact=True).fill(token)
    page.get_by_label('连接开发机', exact=True).click()
    expect(page.get_by_text('已连接原生聊天记录 · pi', exact=True)).to_be_visible()
    expect(page.get_by_text('连接你的开发机', exact=True)).not_to_be_visible()
    page.screenshot(path=str(artifacts / 'phone-chat.png'))
    check('connected to the exact original transcript', True)

    composer = page.get_by_label('发给原会话的消息', exact=True)
    draft = '继续优化移动端\n保留中文多行输入和每个 session 的草稿。'
    composer.fill(draft)
    deadline = time.monotonic() + 5
    while not page.evaluate("Object.values(localStorage).some(v => v.includes('继续优化移动端'))"):
        assert time.monotonic() < deadline, 'draft was not saved'
        time.sleep(0.05)
    page.reload()
    expect(page.get_by_label('发给原会话的消息', exact=True)).to_have_value(draft)
    check('draft survives browser refresh', True)

    page.get_by_label('打开会话列表', exact=True).click()
    expect(page.get_by_label('搜索会话', exact=True)).to_be_visible()
    page.get_by_label('搜索会话', exact=True).fill('mobile-herdr')
    expect(page.get_by_label('打开 w3:p1', exact=True)).not_to_be_visible()
    page.get_by_label('搜索会话', exact=True).fill('')
    expect(page.get_by_label('打开 w3:p1', exact=True)).to_be_visible()
    deadline = time.monotonic() + 5
    while page.get_by_label('关闭会话列表', exact=True).bounding_box()['y'] > 70:
        assert time.monotonic() < deadline, 'session drawer did not settle'
        time.sleep(0.02)
    page.screenshot(path=str(artifacts / 'phone-sessions.png'))
    page.get_by_label('打开 w3:p1', exact=True).click()
    expect(page.get_by_text('Agent 正在等待你确认，打开终端查看并操作。', exact=True)).to_be_visible()
    expect(page.get_by_label('发送消息', exact=True)).to_be_disabled()
    page.screenshot(path=str(artifacts / 'phone-blocked.png'))
    check('blocked agent exposes terminal action and disables chat send', True)
    page.get_by_label('打开会话列表', exact=True).click()
    page.get_by_label('打开 w1:p1', exact=True).click()
    expect(page.get_by_label('发给原会话的消息', exact=True)).to_have_value(draft)
    check('draft stays attached to its original pane across navigation', True)

    # A server-side failure must not clear text or show success.
    page.route('**/api/panes/**/prompt?*', lambda route: route.fulfill(status=409, content_type='application/json', body=json.dumps({'error': {'code': 'agent_busy', 'message': '测试：agent 状态已变化'}})))
    page.get_by_label('发送消息', exact=True).click()
    expect(page.get_by_text('测试：agent 状态已变化', exact=True)).to_be_visible()
    expect(page.get_by_label('发给原会话的消息', exact=True)).to_have_value(draft)
    check('failed send preserves the draft', True)
    page.unroute('**/api/panes/**/prompt?*')
    page.get_by_label('关闭提示', exact=True).click()
    page.get_by_label('发送消息', exact=True).click()
    expect(page.get_by_label('发给原会话的消息', exact=True)).to_have_value('')
    expect(page.get_by_text(draft, exact=True)).to_be_visible()
    check('successful send appears in the original transcript', True)

    for width, height in [(320, 568), (360, 740), (390, 844), (430, 932), (844, 390), (768, 1024)]:
        page.set_viewport_size({'width': width, 'height': height})
        page.evaluate("() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
        composer = page.get_by_label('发给原会话的消息', exact=True)
        expect(composer).to_be_visible()
        box = page.get_by_label('发送消息', exact=True).bounding_box()
        check(f'{width}x{height}: send action stays in the viewport', box and box['y'] + box['height'] <= height + 1)
        check(f'{width}x{height}: no horizontal page overflow', page.evaluate('document.documentElement.scrollWidth <= innerWidth'))

    # Simulate a reduced visual viewport, as used by iOS Safari while its keyboard is open.
    page.set_viewport_size({'width': 390, 'height': 844})
    page.get_by_label('发给原会话的消息', exact=True).focus()
    page.evaluate("Object.defineProperty(visualViewport, 'height', {value: 450, configurable: true}); visualViewport.dispatchEvent(new Event('resize'))")
    expect(page.get_by_text('开发机', exact=True)).not_to_be_visible()
    box = page.get_by_label('发送消息', exact=True).bounding_box()
    check('keyboard-sized visual viewport keeps the composer visible', box and box['y'] + box['height'] <= 450)
    page.screenshot(path=str(artifacts / 'phone-keyboard-viewport.png'), clip={'x': 0, 'y': 0, 'width': 390, 'height': 450})
    page.evaluate("delete visualViewport.height; visualViewport.dispatchEvent(new Event('resize'))")

    # Losing the socket disables writes; typed text must survive reconnect.
    context.set_offline(True)
    page.get_by_label('发给原会话的消息', exact=True).fill('断网时保留的草稿')
    expect(page.get_by_label('发送消息', exact=True)).to_be_disabled(timeout=10000)
    page.screenshot(path=str(artifacts / 'phone-offline.png'))
    context.set_offline(False)
    expect(page.get_by_label('发送消息', exact=True)).to_be_enabled(timeout=20000)
    expect(page.get_by_label('发给原会话的消息', exact=True)).to_have_value('断网时保留的草稿')
    check('disconnect disables writes and reconnect preserves editable draft', True)

    page.set_viewport_size({'width': 1280, 'height': 900})
    page.evaluate("() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
    expect(page.get_by_label('搜索会话', exact=True)).to_be_visible()
    expect(page.get_by_text('已连接原生聊天记录 · pi', exact=True)).to_be_visible()
    expect(page.get_by_text('接着原来的对话', exact=True)).to_have_count(0)
    page.screenshot(path=str(artifacts / 'desktop-chat.png'))
    page.get_by_label('发给原会话的消息', exact=True).fill('')
    page.set_viewport_size({'width': 390, 'height': 844})
    page.get_by_role('tab', name='终端', exact=True).click()
    frame = page.frame_locator('iframe[title="原始 Herdr 终端"]')
    expect(frame.locator('#keys')).to_be_visible()
    check('terminal has a touch keyboard shortcut strip', True)
    check('no uncaught browser errors', not errors)
    context.close()
    browser.close()

(artifacts / 'verification.json').write_text(json.dumps({'checks': checks, 'errors': errors}, ensure_ascii=False, indent=2))
print(f'Browser verification: {len(checks)} checks passed; 0 uncaught errors.')
