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
motion_events = []

def check(name, condition):
    assert condition, name
    checks.append(name)

def snapshot(page, name, **options):
    # Capture the settled state, excluding continuously animated loading spinners.
    page.wait_for_function("() => document.getAnimations().filter(a => a.effect.getComputedTiming().iterations !== Infinity).every(a => a.playState !== 'running')")
    page.screenshot(path=str(artifacts / name), **options)

def motion_frames(page, name, selector, restart=False):
    target = page.locator(selector)
    count = target.evaluate("""(el, restart) => {
      if (restart) { el.style.animation = 'none'; void el.offsetHeight; el.style.animation = ''; }
      void el.offsetHeight;
      window.sampledAnimations = el.getAnimations({subtree: true});
      window.sampledAnimations.forEach(a => a.pause());
      return window.sampledAnimations.length;
    }""", restart)
    assert count, (name + ': animation missing', target.evaluate("el => ({tag:el.tagName, role:el.getAttribute('role'), active:el.matches(':active'), disabled:el.getAttribute('aria-disabled'), transform:getComputedStyle(el).transform, transition:getComputedStyle(el).transition, activeTags:[...document.querySelectorAll(':active')].map(el=>el.tagName)})"))
    folder = artifacts / 'motion' / name
    folder.mkdir(parents=True, exist_ok=True)
    for label, fraction in [('start',0),('mid',0.5),('end',1)]:
        page.evaluate("fraction => window.sampledAnimations.forEach(a => { a.currentTime = a.effect.getTiming().duration * fraction; })", fraction)
        page.screenshot(path=str(folder / (label + '.png')))
    page.evaluate("window.sampledAnimations.forEach(a => a.finish()); delete window.sampledAnimations")

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    context = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=1, is_mobile=True, has_touch=True,
                                  record_video_dir=str(artifacts / 'video'), record_video_size={'width': 390, 'height': 844})
    page = context.new_page()
    video_start = time.monotonic()
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('console', lambda message: errors.append(message.text) if message.type == 'error' and 'Failed to load resource' not in message.text else None)
    page.goto(url)
    page.wait_for_load_state('networkidle')
    snapshot(page, 'phone-connect.png')
    page.get_by_label('机器名称', exact=True).fill('我的开发机')
    page.get_by_label('连接密钥', exact=True).fill('short')
    page.get_by_label('连接开发机', exact=True).click()
    expect(page.get_by_role('alert')).to_contain_text('完整连接密钥')
    expect(page.get_by_label('机器名称', exact=True)).to_have_value('我的开发机')
    expect(page.get_by_label('Bridge 地址', exact=True)).to_have_value(url)
    check('connection validation preserves the entered machine and address', True)
    page.get_by_label('机器名称', exact=True).fill('')
    page.get_by_label('连接密钥', exact=True).fill(token)
    motion_events.append({'name': 'conversation-entry', 'seconds': time.monotonic() - video_start})
    page.get_by_label('连接开发机', exact=True).click()
    expect(page.get_by_text('已连接原生聊天记录 · pi', exact=True)).to_be_visible()
    expect(page.get_by_text('连接你的开发机', exact=True)).not_to_be_visible()
    page.wait_for_function("() => [...document.querySelectorAll('.markdown')].every(el => el.getAnimations().every(a => a.playState === 'finished'))")
    motion_frames(page, 'conversation-entry', '[data-testid="conversation-content"]', restart=True)
    snapshot(page, 'phone-chat.png')
    check('connected to the exact original transcript', True)

    composer = page.get_by_label('发给原会话的消息', exact=True)
    draft = '继续优化移动端\n保留中文多行输入和每个 session 的草稿。'
    page.evaluate("""() => {
      window.savedSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) {
        if (key.startsWith('mobile-herdr-draft:')) throw new DOMException('Fixture quota failure', 'QuotaExceededError');
        return window.savedSetItem.call(this, key, value);
      };
    }""")
    composer.fill('保存失败仍保留的输入')
    expect(page.get_by_role('alert')).to_contain_text('草稿保存失败')
    expect(page.get_by_text('草稿未保存', exact=True)).to_be_visible()
    expect(composer).to_have_value('保存失败仍保留的输入')
    check('draft storage failure is visible and preserves editable text', True)
    page.evaluate('Storage.prototype.setItem = window.savedSetItem; delete window.savedSetItem')
    page.get_by_label('关闭提示', exact=True).click()
    composer.fill(draft)
    expect(page.get_by_text('草稿已保存', exact=True)).to_be_visible()
    snapshot(page, 'phone-draft.png')
    deadline = time.monotonic() + 5
    while not page.evaluate("Object.values(localStorage).some(v => v.includes('继续优化移动端'))"):
        assert time.monotonic() < deadline, 'draft was not saved'
        time.sleep(0.05)
    page.reload()
    expect(page.get_by_label('发给原会话的消息', exact=True)).to_have_value(draft)
    check('draft survives browser refresh', True)

    history = page.get_by_test_id('conversation-scroll')
    history.evaluate('el => { el.scrollTop = 0; }')
    expect(page.get_by_label('回到最新消息', exact=True)).to_be_visible()
    snapshot(page, 'phone-history.png')
    page.get_by_label('回到最新消息', exact=True).click()
    expect(page.get_by_label('回到最新消息', exact=True)).not_to_be_visible()
    check('reading history exposes a working return-to-latest action', history.evaluate('el => el.scrollHeight - el.scrollTop - el.clientHeight < 100'))

    motion_events.append({'name': 'session-drawer', 'seconds': time.monotonic() - video_start})
    page.get_by_label('打开会话列表', exact=True).click()
    expect(page.get_by_label('搜索会话', exact=True)).to_be_visible()
    page.get_by_label('搜索会话', exact=True).fill('mobile-herdr')
    expect(page.get_by_label('打开 w3:p1', exact=True)).not_to_be_visible()
    page.get_by_label('清除搜索', exact=True).click()
    expect(page.get_by_label('打开 w3:p1', exact=True)).to_be_visible()
    page.get_by_label('搜索会话', exact=True).fill('codex')
    expect(page.get_by_label('打开 w2:p1', exact=True)).to_be_visible()
    expect(page.get_by_label('打开 w1:p1', exact=True)).not_to_be_visible()
    page.get_by_label('搜索会话', exact=True).fill('w1:p1')
    expect(page.get_by_label('打开 w1:p1', exact=True)).to_be_visible()
    check('session search supports agent names and exact pane IDs', True)
    page.get_by_label('搜索会话', exact=True).fill('不存在的工作区')
    expect(page.get_by_text('没有找到匹配的会话', exact=True)).to_be_visible()
    snapshot(page, 'phone-search-empty.png')
    page.get_by_role('button', name='查看全部会话', exact=True).click()
    expect(page.get_by_label('搜索会话', exact=True)).to_have_value('')
    page.get_by_label('筛选需要处理的会话', exact=True).click()
    expect(page.get_by_label('打开 w3:p1', exact=True)).to_be_visible()
    expect(page.get_by_label('打开 w1:p1', exact=True)).not_to_be_visible()
    page.get_by_label('显示全部会话', exact=True).click()
    expect(page.get_by_label('打开 w1:p1', exact=True)).to_be_visible()
    check('empty search and attention filter have direct recovery actions', True)
    page.get_by_label('搜索会话', exact=True).blur()
    deadline = time.monotonic() + 5
    while page.get_by_label('关闭会话列表', exact=True).bounding_box()['y'] > 70:
        assert time.monotonic() < deadline, 'session drawer did not settle'
        time.sleep(0.02)
    snapshot(page, 'phone-sessions.png')
    page.get_by_label('打开 w3:p1', exact=True).click()
    expect(page.get_by_text('Agent 正在等待你确认，打开终端查看并操作。', exact=True)).to_be_visible()
    expect(page.get_by_label('发送消息', exact=True)).to_be_disabled()
    snapshot(page, 'phone-blocked.png')
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
    motion_events.append({'name': 'send-feedback', 'seconds': time.monotonic() - video_start})
    send = page.get_by_label('发送消息', exact=True)
    send.hover()
    folder = artifacts / 'motion' / 'send-feedback'
    folder.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(folder/'start.png'))
    # Sample the production :active CSS using Chromium's pseudo-state override;
    # actual submission still uses Playwright's normal click below.
    cdp = context.new_cdp_session(page)
    cdp.send('DOM.enable'); cdp.send('CSS.enable')
    document_id = cdp.send('DOM.getDocument')['root']['nodeId']
    node_id = cdp.send('DOM.querySelector', {'nodeId': document_id, 'selector': '[aria-label="发送消息"]'})['nodeId']
    cdp.send('CSS.forcePseudoState', {'nodeId': node_id, 'forcedPseudoClasses': ['active']})
    motion_frames(page, 'send-feedback', '[aria-label="发送消息"]')
    cdp.send('CSS.forcePseudoState', {'nodeId': node_id, 'forcedPseudoClasses': []})
    send.click()
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
    snapshot(page, 'phone-keyboard-viewport.png', clip={'x': 0, 'y': 0, 'width': 390, 'height': 450})
    page.evaluate("delete visualViewport.height; visualViewport.dispatchEvent(new Event('resize'))")

    # Losing the socket disables writes; typed text must survive reconnect.
    context.set_offline(True)
    page.get_by_label('发给原会话的消息', exact=True).fill('断网时保留的草稿')
    expect(page.get_by_label('发送消息', exact=True)).to_be_disabled(timeout=10000)
    expect(page.get_by_label('连接状态：已断开', exact=True)).to_be_visible()
    expect(page.get_by_label('重新连接开发机', exact=True)).to_be_visible()
    snapshot(page, 'phone-offline.png')
    context.set_offline(False)
    expect(page.get_by_label('发送消息', exact=True)).to_be_enabled(timeout=20000)
    expect(page.get_by_label('发给原会话的消息', exact=True)).to_have_value('断网时保留的草稿')
    check('disconnect disables writes and reconnect preserves editable draft', True)

    page.set_viewport_size({'width': 844, 'height': 390})
    page.get_by_label('打开会话列表', exact=True).click()
    page.get_by_label('打开 w3:p1', exact=True).scroll_into_view_if_needed()
    page.get_by_label('打开 w3:p1', exact=True).click()
    expect(page.get_by_text('Agent 正在等待你确认，打开终端查看并操作。', exact=True)).to_be_visible()
    page.get_by_label('打开会话列表', exact=True).click()
    page.get_by_label('打开 w1:p1', exact=True).click()
    check('landscape drawer scrolls to sessions below its filters', True)

    page.set_viewport_size({'width': 1280, 'height': 900})
    page.evaluate("() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
    expect(page.get_by_label('搜索会话', exact=True)).to_be_visible()
    expect(page.get_by_text('已连接原生聊天记录 · pi', exact=True)).to_be_visible()
    expect(page.get_by_text('接着原来的对话', exact=True)).to_have_count(0)
    snapshot(page, 'desktop-chat.png')
    page.get_by_label('发给原会话的消息', exact=True).fill('')
    page.set_viewport_size({'width': 390, 'height': 844})
    page.get_by_role('tab', name='终端', exact=True).click()
    expect(page.get_by_role('tab', name='终端', exact=True)).to_have_attribute('aria-selected', 'true')
    motion_frames(page, 'mode-switch', '[data-testid="mode-tabs"]')
    page.wait_for_function("() => new DOMMatrixReadOnly(getComputedStyle(document.querySelector('[data-testid=\"mode-tabs\"]'), '::before').transform).m41 > 70")
    check('view selector exposes its active tab and moves its selection indicator', True)
    frame = page.frame_locator('iframe[title="原始 Herdr 终端"]')
    expect(frame.locator('#keys')).to_be_visible()
    check('terminal has a touch keyboard shortcut strip', True)
    page.set_viewport_size({'width': 390, 'height': 450})
    expect(frame.locator('#keys')).to_be_visible()
    page.wait_for_function("() => document.querySelector('iframe').getBoundingClientRect().bottom <= innerHeight + 1")
    terminal = page.locator('iframe[title="原始 Herdr 终端"]').bounding_box()
    check('terminal fits within a short mobile viewport', terminal and terminal['y'] + terminal['height'] <= 451)
    page.emulate_media(reduced_motion='reduce')
    page.get_by_role('tab', name='对话', exact=True).click()
    expect(page.get_by_role('tab', name='对话', exact=True)).to_have_attribute('aria-selected', 'true')
    check('reduced motion disables transitions and content animation', page.evaluate("""() =>
      getComputedStyle(document.querySelector('[data-testid="mode-tabs"]'), '::before').transitionDuration === '0s' &&
      [...document.querySelectorAll('.markdown')].every(el => getComputedStyle(el).animationName === 'none')"""))
    detail_context = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, storage_state=context.storage_state())
    detail_page = detail_context.new_page()
    detail_page.goto(url)
    expect(detail_page.get_by_label('发给原会话的消息', exact=True)).to_be_visible()
    snapshot(detail_page, 'phone-detail-2x.png')
    detail_context.close()
    check('no uncaught browser errors', not errors)
    context.close()
    Path(page.video.path()).replace(artifacts / 'interaction.webm')
    browser.close()

(artifacts / 'verification.json').write_text(json.dumps({'checks': checks, 'errors': errors}, ensure_ascii=False, indent=2))
(artifacts / 'motion-events.json').write_text(json.dumps(motion_events, indent=2))
print(f'Browser verification: {len(checks)} checks passed; 0 uncaught errors.')
