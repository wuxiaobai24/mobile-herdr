"""Measure usable reading space, not just whether controls fit inside the screen."""
import json, os, sys
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

out = Path('artifacts/mobile-layout')
baseline = '--baseline' in sys.argv
checks, metrics, errors = [], [], []

def settled(page):
    page.wait_for_function("() => document.getAnimations().filter(a=>a.effect.getComputedTiming().iterations!==Infinity).every(a=>a.playState!=='running')")

def check(name, condition):
    assert condition, name
    checks.append(name)

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    context = browser.new_context(viewport={'width':393,'height':674}, is_mobile=True, has_touch=True, record_video_dir=str(out/'video'))
    page = context.new_page()
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.add_init_script("localStorage.setItem('mobile-herdr-draft:appearance', JSON.stringify({theme:'flexoki-light',readingSize:16,readingFont:'system',terminalSize:13}))")
    page.goto(os.environ['MOBILE_HERDR_TEST_URL'])
    page.wait_for_load_state('networkidle')
    page.get_by_label('连接密钥', exact=True).fill(os.environ['MOBILE_HERDR_TEST_TOKEN'])
    page.get_by_label('连接开发机', exact=True).click()
    composer = page.get_by_label('发给原会话的消息', exact=True)
    expect(composer).to_be_visible()
    expect(composer).to_have_attribute('placeholder','Agent 正在工作…')
    for width, height in [(393,674),(320,568),(390,450),(844,390)]:
        page.set_viewport_size({'width':width,'height':height})
        if not baseline:
            expect(page.get_by_test_id('workbench-header')).to_have_attribute('data-viewport',f'{width}x{height}')
        settled(page)
        scroll = page.get_by_test_id('conversation-scroll').bounding_box()
        field = page.get_by_test_id('composer').bounding_box()
        metrics.append({'width':width,'height':height,'reading':round(scroll['height']),'composer':round(field['height'])})
        page.screenshot(path=str(out/f'{"before" if baseline else "after"}-{width}x{height}.png'))
        if not baseline:
            check(f'{width}x{height}: reading keeps at least 65% of the app', scroll['height'] >= height*.65)
            check(f'{width}x{height}: empty composer is one row', field['height'] <= 58)
            check(f'{width}x{height}: no horizontal overflow', page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
            check(f'{width}x{height}: stop remains a 44px touch target', page.get_by_label('中断 agent', exact=True).bounding_box()['height'] >= 44)
    if not baseline:
        page.set_viewport_size({'width':393,'height':674})
        composer.fill('第一行\n第二行\n第三行\n第四行\n第五行\n第六行\n第七行')
        page.wait_for_function("() => Object.values(localStorage).some(value => value.includes('第一行'))")
        box = page.get_by_test_id('composer').bounding_box()
        check('long drafts grow to a bounded height', 90 <= box['height'] <= 140)
        composer.fill('短草稿')
        page.wait_for_function("() => Object.values(localStorage).some(value => value === '短草稿')")
        check('deleting a draft shrinks the composer again', page.get_by_test_id('composer').bounding_box()['height'] <= 58)
        page.get_by_label('更多会话操作', exact=True).click()
        page.get_by_label('外观设置', exact=True).click()
        expect(page.get_by_role('radio', name='Flexoki Light', exact=True)).to_be_visible()
        page.get_by_role('radio', name='Flexoki Light', exact=True).click()
        page.get_by_label('关闭外观设置', exact=True).click()
        check('secondary actions stay accessible from the mobile menu', True)
        expect(page.get_by_label('关闭外观设置', exact=True)).not_to_be_visible()
        settled(page)
        composer.press('ControlOrMeta+A')
        composer.press('Backspace')
        expect(composer).to_have_value('')
        page.wait_for_function("() => document.querySelector('[data-testid=\"composer-area\"]').getBoundingClientRect().height <= 70")
        composer.focus()
        page.evaluate("Object.defineProperty(visualViewport,'height',{value:360,configurable:true});visualViewport.dispatchEvent(new Event('resize'))")
        page.wait_for_function("() => document.querySelector('#root').getBoundingClientRect().height === 360 && document.querySelector('[data-testid=\"composer-area\"]').getBoundingClientRect().height <= 70")
        settled(page)
        scroll = page.get_by_test_id('conversation-scroll').bounding_box()
        check('360px keyboard viewport keeps at least 65% for reading', scroll['height'] >= 360*.65)
        check('keyboard viewport keeps the stop button visible', page.get_by_label('中断 agent', exact=True).bounding_box()['y'] < 360-43)
        page.screenshot(path=str(out/'keyboard-393x360.png'))
        page.evaluate("delete visualViewport.height;visualViewport.dispatchEvent(new Event('resize'))")
        composer.blur()
        page.get_by_label('更多会话操作',exact=True).click();page.get_by_label('启用手机接管',exact=True).click()
        page.get_by_label('启用并接管当前会话',exact=True).click()
        expect(page.get_by_text('等待当前任务完成，可取消…',exact=True)).to_be_visible()
        page.screenshot(path=str(out/'takeover-waiting.png'))
        page.get_by_label('取消等待接管',exact=True).click()
        expect(page.get_by_text('已取消，当前 agent 保持运行。',exact=True)).to_be_visible()
        check('first-time takeover is one action, waits for work and can be cancelled', True)
        check('no uncaught errors', not errors)
    context.close()
    Path(page.video.path()).replace(out/f'{"before" if baseline else "after"}-interaction.webm')
    browser.close()
(out/f'{"baseline" if baseline else "verification"}.json').write_text(json.dumps({'metrics':metrics,'checks':checks,'errors':errors},ensure_ascii=False,indent=2))
print(json.dumps({'metrics':metrics,'checks':len(checks),'errors':errors}))
