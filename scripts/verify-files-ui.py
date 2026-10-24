"""Files and updater UI against an owned Unix socket and project directory."""
import json, os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

out = Path('artifacts/files-update/ui')
checks, errors, requests = [], [], []
def check(name, condition=True):
    assert condition, name
    checks.append(name)
def snapshot(page, name):
    page.wait_for_function("() => document.getAnimations().filter(a=>a.effect.getComputedTiming().iterations!==Infinity).every(a=>a.playState!=='running')")
    page.screenshot(path=str(out / name))
def more(page, label):
    page.get_by_label('更多会话操作', exact=True).click()
    page.get_by_label(label, exact=True).click()
def fit(page, label, width, height):
    page.get_by_label(label, exact=True).wait_for()
    page.wait_for_function("([label,width,height])=>{const el=document.querySelector('[aria-label=\"'+label+'\"]');const r=el?.getBoundingClientRect();return r&&r.x>=0&&r.right<=width+1&&r.y>=0&&r.bottom<=height+1;}", arg=[label,width,height])
    box = page.get_by_label(label, exact=True).bounding_box()
    check(f'{width}x{height}: {label} reachable', box and box['x'] >= 0 and box['x']+box['width'] <= width+1 and box['y'] >= 0 and box['y']+box['height'] <= height+1)

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    context = browser.new_context(viewport={'width':390,'height':844}, is_mobile=True, has_touch=True, accept_downloads=True, record_video_dir=str(out/'video'))
    page = context.new_page(); page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('request', lambda request: requests.append(request.url))
    page.goto(os.environ['MOBILE_HERDR_TEST_URL']); page.wait_for_load_state('networkidle')
    page.get_by_label('连接密钥', exact=True).fill(os.environ['MOBILE_HERDR_TEST_TOKEN'])
    page.get_by_label('连接开发机', exact=True).click()
    expect(page.get_by_label('发给原会话的消息', exact=True)).to_be_visible()
    more(page, '浏览项目文件')
    expect(page.get_by_label('打开目录 src', exact=True)).to_be_visible()
    expect(page.get_by_label('打开文件 external-link', exact=True)).to_be_disabled()
    check('files open from the phone menu; external links are unavailable')
    snapshot(page, 'files-phone.png')
    page.get_by_label('打开目录 src', exact=True).click()
    page.get_by_label('打开文件 hello.ts', exact=True).click()
    expect(page.get_by_test_id('file-text-preview')).to_contain_text('export const greeting = "你好";')
    check('directory navigation and code preview use the selected pane project')
    snapshot(page, 'preview-code.png')
    page.get_by_label('返回文件目录', exact=True).click(); page.get_by_label('返回文件目录', exact=True).click()
    page.get_by_label('筛选当前目录', exact=True).fill('说明')
    expect(page.get_by_label('打开目录 src', exact=True)).not_to_be_visible()
    with page.expect_download() as download_info:
        page.get_by_label('下载文件 说明 文档.md', exact=True).click()
    download = download_info.value
    check('Chinese download name and file bytes are preserved', download.suggested_filename == '说明 文档.md' and Path(download.path()).read_text() == '# 手机文件\n\n内容预览 ✓')
    page.get_by_label('清空文件筛选', exact=True).click()
    page.get_by_label('打开文件 preview.png', exact=True).click()
    expect(page.get_by_label('图片预览 preview.png', exact=True)).to_be_visible()
    page.wait_for_function("() => [...document.images].filter(i=>i.src.startsWith('data:image/')).some(i=>i.complete&&i.naturalWidth>0)")
    check('image preview decodes without exposing credentials')
    snapshot(page, 'preview-image.png')
    page.get_by_label('返回文件目录', exact=True).click()
    page.get_by_label('打开文件 archive.bin', exact=True).click()
    expect(page.get_by_text('此格式暂不支持预览', exact=True)).to_be_visible()
    with page.expect_download() as download_info:
        page.get_by_label('下载后查看', exact=True).click()
    check('binary preview offers an exact download', Path(download_info.value.path()).read_bytes() == bytes([0,1,2,255]))
    page.get_by_label('返回文件目录', exact=True).click()
    page.get_by_label('打开文件 large.txt', exact=True).click()
    expect(page.get_by_text('仅预览前 256 KB，下载可查看完整文件。', exact=True)).to_be_visible()
    check('large text preview is bounded and clearly marked')
    page.get_by_label('返回文件目录', exact=True).click()
    page.get_by_label('打开目录 empty', exact=True).click()
    expect(page.get_by_text('目录为空', exact=True)).to_be_visible()
    page.get_by_label('返回文件目录', exact=True).click()
    page.route('**/api/panes/*/files?*', lambda route: route.abort('failed'))
    page.get_by_label('打开目录 src', exact=True).click()
    expect(page.get_by_role('alert')).to_contain_text('无法连接开发机')
    page.unroute('**/api/panes/*/files?*')
    page.get_by_label('重试读取文件', exact=True).click()
    expect(page.get_by_label('打开文件 hello.ts', exact=True)).to_be_visible()
    check('read failure retains the directory and explicit retry succeeds')
    page.get_by_label('关闭文件浏览', exact=True).click()
    composer = page.get_by_label('发给原会话的消息', exact=True)
    composer.fill('/files'); page.get_by_label('发送消息', exact=True).click()
    expect(page.get_by_test_id('file-browser')).to_be_visible()
    check('files slash command opens the browser')
    for width,height in [(320,568),(390,450),(844,390)]:
        page.set_viewport_size({'width':width,'height':height})
        fit(page, '关闭文件浏览', width, height)
        check(f'{width}x{height}: files have no horizontal overflow', page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
        snapshot(page, f'files-{width}-{height}.png')
    page.get_by_label('关闭文件浏览', exact=True).click()
    # No real release install occurs. Exercise only UI against controlled responses.
    state = {'phase':'idle','current':'0.2.2-beta.6','latest':'0.2.2-beta.7','available':True,'supported':True,'message':'有新版本可用。'}
    posts, fail_delivery = [], [True]
    def updates(route):
        if route.request.method == 'POST':
            posts.append(route.request.headers.get('x-request-id'))
            if fail_delivery[0]:
                fail_delivery[0] = False
                route.abort('failed'); return
            state.update(phase='installing',message='正在下载并校验最新版本…')
        route.fulfill(json=state)
    page.route('**/api/update', lambda route: route.abort('failed'))
    more(page, '版本更新')
    expect(page.get_by_role('alert')).to_contain_text('无法连接开发机')
    check('update check failures expose explicit retry')
    page.unroute('**/api/update'); page.route('**/api/update', updates)
    page.get_by_label('重试检查更新', exact=True).click()
    expect(page.get_by_label('一键更新到最新版本', exact=True)).to_be_enabled()
    snapshot(page, 'update-available.png')
    page.get_by_label('一键更新到最新版本', exact=True).click()
    expect(page.get_by_role('alert')).to_contain_text('操作可能已经送达')
    expect(page.get_by_label('一键更新到最新版本', exact=True)).to_be_enabled()
    check('interrupted update does not automatically resend', len(posts) == 1)
    page.get_by_label('一键更新到最新版本', exact=True).click()
    expect(page.get_by_text('正在下载并校验最新版本…', exact=True)).to_be_visible()
    expect(page.get_by_label('一键更新到最新版本', exact=True)).to_be_disabled()
    check('explicit ambiguous retry reuses the request ID and disables duplicate taps', len(posts)==2 and bool(posts[0]) and posts[0] == posts[1])
    state.update(phase='failed',message='网络中断，原 Bridge 继续运行。')
    page.get_by_label('关闭版本更新', exact=True).click(); more(page, '版本更新')
    expect(page.get_by_text('网络中断，原 Bridge 继续运行。', exact=True)).to_be_visible()
    expect(page.get_by_label('一键更新到最新版本', exact=True)).to_be_enabled()
    check('failed updates can be retried')
    for width,height in [(320,568),(390,450),(844,390)]:
        page.set_viewport_size({'width':width,'height':height})
        fit(page, '关闭版本更新', width, height)
        fit(page, '一键更新到最新版本', width, height)
        snapshot(page, f'update-{width}-{height}.png')
    state.update(phase='ready',current='0.2.2-beta.7',available=False,message='更新完成。')
    page.get_by_label('重新检查版本', exact=True).click()
    expect(page.get_by_text('加载新版本', exact=True)).to_be_visible()
    check('completed update offers a page reload')
    check('credentials never enter file or update URLs', not any(os.environ['MOBILE_HERDR_TEST_TOKEN'] in url for url in requests))
    check('no browser runtime errors', not errors)
    context.close(); browser.close()
(out / 'report.json').write_text(json.dumps({'passed':len(checks),'checks':checks}, ensure_ascii=False, indent=2))
print(json.dumps({'passed':len(checks)}, ensure_ascii=False))
