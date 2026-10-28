import json,os,re,urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
out=Path('artifacts/download-ui');checks=[];errors=[];requests=[]
def check(name,value=True):
    assert value,name
    checks.append(name)
def fixture(path):
    with urllib.request.urlopen(os.environ['MOBILE_HERDR_TEST_URL']+path) as response:return json.load(response)
def shot(page,name):
    page.screenshot(path=str(out/name))
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    context=browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True,accept_downloads=True)
    page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.on('request',lambda r:requests.append(r.url))
    page.goto(os.environ['MOBILE_HERDR_TEST_URL']);page.get_by_label('连接密钥',exact=True).fill(os.environ['MOBILE_HERDR_TEST_TOKEN']);page.get_by_label('连接开发机',exact=True).click()
    page.get_by_label('下载项目文件 slow.apk',exact=True).click()
    expect(page.get_by_text('正在下载',exact=False)).to_contain_text('%',timeout=10000)
    shot(page,'chat-progress.png');page.get_by_label('取消下载 slow.apk',exact=True).click()
    expect(page.get_by_text('已取消下载。',exact=False)).to_be_visible();check('chat file link streams authenticated progress and can cancel')
    with page.expect_download() as event:page.get_by_label('下载项目文件 slow.apk',exact=True).click()
    download=event.value
    check('chat absolute project link downloads exact bytes instead of reopening the app',download.suggested_filename=='slow.apk' and Path(download.path()).read_bytes()==bytes([42])*(2*1024*1024))
    expect(page.get_by_text('已交给浏览器下载，请查看浏览器下载列表。',exact=False)).to_be_visible()
    fixture('/fixture-fail');page.get_by_label('下载项目文件 slow.apk',exact=True).click()
    expect(page.get_by_role('alert')).to_be_visible(timeout=10000);check('interrupted transfer exposes an error and enables explicit retry')
    fixture('/fixture-reset')
    page.get_by_label('更多会话操作',exact=True).click();page.get_by_label('浏览项目文件',exact=True).click()
    page.get_by_label('下载文件 slow.apk',exact=True).click()
    status=page.get_by_test_id('download-status');expect(status).to_contain_text('%',timeout=10000)
    shot(page,'files-progress.png');page.get_by_label('取消文件下载',exact=True).click()
    expect(status).to_contain_text('已取消下载');check('file browser uses the same progress and cancellation flow')
    with page.expect_download() as event:page.get_by_label('下载文件 slow.apk',exact=True).click()
    check('file browser retry completes exact bytes',Path(event.value.path()).stat().st_size==2*1024*1024)
    expect(status).to_contain_text('浏览器下载列表');page.get_by_label('关闭文件浏览',exact=True).click()
    page.get_by_label('更多会话操作',exact=True).click();page.get_by_label('版本更新',exact=True).click()
    expect(page.get_by_label('下载最新 Android APK',exact=True)).to_be_visible(timeout=15000)
    page.get_by_label('下载最新 Android APK',exact=True).click()
    expect(page.get_by_test_id('download-status')).to_contain_text('%',timeout=10000)
    shot(page,'apk-progress.png');page.get_by_label('取消文件下载',exact=True).click()
    expect(page.get_by_test_id('download-status')).to_contain_text('已取消下载');check('version panel downloads local APK with progress and cancellation')
    for w,h in [(320,568),(390,450)]:
        page.set_viewport_size({'width':w,'height':h});expect(page.get_by_label('下载最新 Android APK',exact=True)).to_be_in_viewport();shot(page,f'update-{w}x{h}.png')
    check('no credentials in download URLs',not any(os.environ['MOBILE_HERDR_TEST_TOKEN'] in url for url in requests))
    check('no browser runtime errors',not errors)
    context.close();browser.close()
(out/'verification.json').write_text(json.dumps({'checks':checks,'count':len(checks)},ensure_ascii=False,indent=2));print(f'Download UI: {len(checks)} checks passed.')
