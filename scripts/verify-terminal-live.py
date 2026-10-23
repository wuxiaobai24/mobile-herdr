import os
from playwright.sync_api import sync_playwright, expect
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    context=browser.new_context(viewport={'width':393,'height':674},is_mobile=True,has_touch=True)
    page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(os.environ['MOBILE_HERDR_TEST_URL'])
    page.get_by_label('连接密钥',exact=True).fill(os.environ['MOBILE_HERDR_TEST_TOKEN']);page.get_by_label('连接开发机',exact=True).click()
    page.get_by_role('tab',name='终端',exact=True).click()
    frame=page.frame_locator('iframe[title="原始 Herdr 终端"]')
    expect(frame.locator('#state')).to_contain_text('实时终端',timeout=15000)
    frame.get_by_label('打开终端键盘',exact=True).click()
    expect(frame.locator('.xterm-helper-textarea')).to_be_focused()
    # Key events use the actual xterm input path and real Herdr attach subprocess.
    page.keyboard.type("printf 'TERMINAL_BROWSER_%s\\n' VERIFIED",delay=5)
    frame.get_by_role('button',name='Enter',exact=True).click()
    expect(frame.locator('.xterm-screen')).to_contain_text('TERMINAL_BROWSER_VERIFIED',timeout=15000)
    page.screenshot(path='artifacts/terminal-live/keyboard.png')
    page.get_by_role('tab',name='对话',exact=True).click();page.get_by_role('tab',name='终端',exact=True).click()
    expect(frame.locator('#state')).to_contain_text('实时终端')
    # A tap opens keyboard; drag browsing has separate no-input checks in the UI suite.
    box=frame.locator('#terminal').bounding_box();page.touchscreen.tap(box['x']+20,box['y']+30)
    expect(frame.locator('.xterm-helper-textarea')).to_be_focused()
    assert not errors,errors
    context.close();browser.close()
