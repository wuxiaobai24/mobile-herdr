"""Mobile-viewport browser flows against an isolated native broker and protocol peer."""
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

url = os.environ['MOBILE_HERDR_TEST_URL']
token = os.environ['MOBILE_HERDR_TEST_TOKEN']
artifacts = Path('artifacts/native-ui')
checks = []
errors = []

def check(name, condition=True):
    assert condition, name
    checks.append(name)

def connect(page):
    page.goto(url)
    page.wait_for_load_state('networkidle')
    page.get_by_label('连接密钥', exact=True).fill(token)
    page.get_by_label('连接开发机', exact=True).click()
    expect(page.get_by_text('电脑正在控制', exact=True)).to_be_visible()

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    context = browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True,
                                  record_video_dir=str(artifacts / 'video'), record_video_size={'width': 390, 'height': 844})
    page = context.new_page()
    page.on('pageerror', lambda error: errors.append(str(error)))
    connect(page)
    composer = page.get_by_label('发给原会话的消息', exact=True)
    composer.fill('先写草稿')
    expect(page.get_by_label('发送消息', exact=True)).to_be_disabled()
    page.screenshot(path=str(artifacts / 'phone-desktop-owner.png'))
    check('desktop ownership allows drafting and blocks phone sends')
    page.get_by_label('在手机继续', exact=True).click()
    expect(page.get_by_text('你正在手机上继续', exact=True)).to_be_visible()
    page.get_by_label('发送消息', exact=True).click()
    expect(page.get_by_text('已收到：先写草稿', exact=True)).to_be_visible()
    expect(page.get_by_label('中断 agent', exact=True)).to_be_visible()
    check('one tap takeover sends through the native provider and streams a reply')

    other = browser.new_context(viewport={'width': 390, 'height': 844})
    second = other.new_page()
    second.goto(url)
    second.wait_for_load_state('networkidle')
    second.get_by_label('连接密钥', exact=True).fill(token)
    second.get_by_label('连接开发机', exact=True).click()
    expect(second.get_by_text('另一台设备正在控制', exact=True)).to_be_visible()
    expect(second.get_by_label('在手机继续', exact=True)).to_be_disabled()
    check('a second phone cannot silently steal control')

    composer.fill('断线草稿')
    context.set_offline(True)
    expect(page.get_by_label('发送消息', exact=True)).to_be_disabled()
    expect(composer).to_have_value('断线草稿')
    context.set_offline(False)
    expect(page.get_by_label('发送消息', exact=True)).to_be_enabled(timeout=15000)
    check('disconnect preserves the draft and disables writes')

    composer.fill('断线结果验证')
    def lose_receipt(route):
        if route.request.method == 'POST' and route.request.post_data_json.get('action') == 'prompt':
            route.fetch()
            route.abort('failed')
        else:
            route.continue_()
    page.route('**/api/panes/**/native?*', lose_receipt)
    page.get_by_label('发送消息', exact=True).click()
    expect(page.get_by_role('alert')).to_contain_text('操作可能已经送达')
    expect(composer).to_have_value('断线结果验证')
    page.unroute('**/api/panes/**/native?*')
    page.reload()
    expect(page.get_by_text('你正在手机上继续', exact=True)).to_be_visible()
    composer = page.get_by_label('发给原会话的消息', exact=True)
    expect(composer).to_have_value('断线结果验证')
    page.get_by_label('发送消息', exact=True).click()
    expect(composer).to_have_value('')
    expect(page.get_by_text('断线结果验证', exact=True)).to_have_count(1)
    check('an ambiguous send survives refresh and retries the original receipt without duplication')

    composer.fill('需要审批')
    page.get_by_label('发送消息', exact=True).click()
    expect(page.get_by_label('允许本次操作', exact=True)).to_be_visible()
    page.screenshot(path=str(artifacts / 'phone-approval.png'))
    page.get_by_label('允许本次操作', exact=True).click()
    expect(page.get_by_text('需要你的确认', exact=True)).not_to_be_visible()
    check('native approval is answered in chat')

    composer.fill('需要问题')
    page.get_by_label('发送消息', exact=True).click()
    page.get_by_text('深色', exact=True).click()
    page.get_by_label('提交回答', exact=True).click()
    expect(page.get_by_text('Agent 需要你的回答', exact=True)).not_to_be_visible()
    check('structured questions are answered in chat')

    for width, height in [(320, 568), (360, 740), (390, 844), (430, 932), (844, 390)]:
        page.set_viewport_size({'width': width, 'height': height})
        expect(page.get_by_label('交还电脑', exact=True)).to_be_visible()
        try:
            page.wait_for_function("() => document.querySelector('[aria-label=\"发送消息\"]').getBoundingClientRect().bottom <= innerHeight + 1", timeout=3000)
        except Exception:
            page.screenshot(path=str(artifacts / 'layout-failure.png'))
            raise
        box = page.get_by_label('发送消息', exact=True).bounding_box()
        check(f'{width}x{height}: composer stays reachable', box and box['y'] + box['height'] <= height + 1)
        check(f'{width}x{height}: no horizontal overflow', page.evaluate('document.documentElement.scrollWidth <= innerWidth'))

    page.set_viewport_size({'width': 390, 'height': 844})
    composer.focus()
    page.evaluate("Object.defineProperty(visualViewport, 'height', {value: 450, configurable: true}); visualViewport.dispatchEvent(new Event('resize'))")
    expect(page.get_by_text('会话', exact=True)).not_to_be_visible()
    box = page.get_by_label('发送消息', exact=True).bounding_box()
    check('keyboard viewport retains takeover and send controls', box and box['y'] + box['height'] <= 451)
    page.screenshot(path=str(artifacts / 'phone-keyboard.png'))
    page.evaluate("delete visualViewport.height; visualViewport.dispatchEvent(new Event('resize'))")
    composer.blur()
    page.get_by_label('交还电脑', exact=True).click()
    expect(page.get_by_text('电脑正在控制', exact=True)).to_be_visible()
    expect(page.get_by_label('发送消息', exact=True)).to_be_disabled()
    expect(second.get_by_text('电脑正在控制', exact=True)).to_be_visible()
    check('handoff returns the same runtime to desktop and updates other devices')
    page.screenshot(path=str(artifacts / 'phone-returned.png'))
    check('no uncaught browser errors', not errors)
    other.close()
    context.close()
    browser.close()

print(f'Native browser verification: {len(checks)} checks passed; {len(errors)} uncaught errors.')
