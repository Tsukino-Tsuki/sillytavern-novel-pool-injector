// 作者：wwj；仅针对隔离的 SillyTavern 测试实例，合成正文不会请求真实小说令牌。
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { prepareVariables, expandVariables, readSynchronizedVariables } = require('./browser-variables.cjs');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const results = [], errors = [], requests = [];
  let failure = false, delay = 0, seq = 0;
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/search/visit', async (route) => {
    const payload = route.request().postDataJSON();
    if (payload.url.startsWith('https://www.rfc-editor.org/')) return route.continue();
    requests.push({ at: Date.now(), payload });
    assert.equal(payload.html, false);
    assert.match(payload.url, /\/v1\/excerpt\/a{43}\?chars=8000$/);
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    await route.fulfill(failure
      ? { status: 500, contentType: 'text/plain', body: 'Internal Server Error' }
      : { status: 200, contentType: 'text/plain; charset=utf-8', body: `${++seq}` + '文'.repeat(7999) });
  });
  try {
    await page.goto(process.env.ST_TEST_URL || 'http://127.0.0.1:8899', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.getElementById('nci-source') && window.SillyTavern?.getContext);
    assert.equal(await page.locator('#nci-drawer .nci-intro code').textContent(), '{{getvar::current_chapter}}');
    const onboarding = page.locator('dialog[open]').filter({ has: page.locator('.onboarding') }).locator('.popup-button-ok');
    if (await onboarding.count()) await onboarding.evaluate((button) => button.click());
    await page.evaluate(() => new Promise((resolve) => {
      const ctx = window.SillyTavern.getContext();
      ctx.eventSource.on(ctx.eventTypes.APP_READY, resolve);
    }));
    await page.evaluate(async () => {
      const ctx = window.SillyTavern.getContext();
      if (!ctx.characters.some((c) => c.name === 'Client Test')) {
        const response = await fetch('/api/characters/create', {
          method: 'POST', headers: ctx.getRequestHeaders(),
          body: JSON.stringify({ ch_name: 'Client Test', description: 'synthetic test', first_mes: 'Hello',
            personality: '', scenario: '', mes_example: '', creator_notes: '', tags: [] }),
        });
        if (!response.ok) throw new Error('测试角色创建失败: ' + response.status);
      }
      await ctx.getCharacters();
      await window.SillyTavern.getContext().selectCharacterById(
        window.SillyTavern.getContext().characters.findIndex((c) => c.name === 'Client Test'));
    });
    const change = (id, value) => page.evaluate(({ id, value }) => {
      const el = document.getElementById(id);
      el.value = value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, { id, value });
    await prepareVariables(page, change, results);
    const vars = () => readSynchronizedVariables(page);
    const generate = (type, dry = false) => page.evaluate(async ({ type, dry }) => {
      const ctx = window.SillyTavern.getContext();
      await ctx.eventSource.emit(ctx.eventTypes.GENERATION_AFTER_COMMANDS, type, {}, dry);
      return ctx.substituteParams('{{getvar::current_chapter}}');
    }, { type, dry });
    await page.evaluate(() => {
      const el = document.getElementById('nci-auto'); el.checked = true;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const liveRead = await page.evaluate(async () => {
      const ctx = window.SillyTavern.getContext();
      const response = await fetch('/api/search/visit', { method: 'POST', headers: ctx.getRequestHeaders(),
        body: JSON.stringify({ html: false,
          url: 'https://www.rfc-editor.org/rfc/rfc9110.txt' }) });
      return { status: response.status, type: response.headers.get('content-type'), text: await response.text() };
    });
    if (liveRead.status === 200) {
      assert.match(liveRead.type, /text\/plain/);
      assert.match(liveRead.text, /HTTP Semantics/);
      results.push('默认config下真实/api/search/visit原样读取公网纯文本成功，未启用CORS代理');
    } else {
      results.push(`公网读取验证未通过（HTTP ${liveRead.status}），需结合隔离酒馆日志判断网络限制`);
    }
    await change('nci-source', 'remote');
    await change('nci-remote-token', `https://novel.example/v1/excerpt/${'a'.repeat(43)}?chars=8000`);
    assert.equal(await page.locator('#nci-remote-base').inputValue(), 'https://novel.example');
    assert.equal(await page.locator('#nci-remote-token').inputValue(), 'a'.repeat(43));
    results.push('完整链接自动解析；模块与动态安装目录在真实酒馆正常加载');
    delay = 100;
    const first = await generate('normal');
    assert.equal(first.length, 8000);
    assert.equal(requests.length, 1);
    assert.equal((await vars()).current_chapter, first);
    results.push('真实EventEmitter等待获取完毕，一次请求写入3个变量，全部getvar宏读到相同片段');
    await expandVariables(page, results);
    assert.equal((await vars()).current_chapter, first);
    assert.equal(requests.length, 1);
    await generate('continue');
    await generate('quiet');
    await generate('normal', true);
    assert.equal(requests.length, 1);
    await generate('regenerate');
    await generate('swipe');
    assert.equal(requests.length, 3);
    await vars();
    results.push('重新生成与swipe刷新，continue、quiet与dryRun不请求');
    const old = (await vars()).current_chapter;
    failure = true;
    delay = 0;
    const failed = await generate('normal');
    assert.equal(failed, old);
    assert.equal((await vars()).current_chapter, old);
    assert.equal(requests.length, 7);
    const retryTimes = requests.slice(3).map((r) => r.at);
    for (let i = 1; i < retryTimes.length; i++) assert.ok(retryTimes[i] - retryTimes[i - 1] >= 990);
    assert.match(await page.locator('#nci-remote-status').textContent(), /沿用.*旧内容/);
    results.push('失败总请求4次，真实重试间隔≥1秒，最后提示并保留旧内容');
    failure = false;
    await page.evaluate(() => {
      const el = document.getElementById('nci-manual'); el.checked = true;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await generate('normal');
    assert.equal(requests.length, 7);
    await page.locator('#nci-inject-btn').evaluate((button) => button.click());
    await page.waitForFunction(() => document.getElementById('nci-remote-status').textContent.includes('已获取并注入'));
    assert.equal(requests.length, 8);
    await vars();
    results.push('手动模式不自动请求，输入框按钮可获取并注入');
    await change('nci-source', 'local');
    await page.locator('#nci-file').setInputFiles({ name: 'test.txt', mimeType: 'text/plain',
      buffer: Buffer.from('第一章 开始\n甲的故事。\n第二章 继续\n乙的故事。\n第三章 结束\n丙的故事。') });
    await page.waitForFunction(() => document.getElementById('nci-status').textContent.includes('已注入第 1 ~ 1'));
    await page.evaluate(() => window['novel-chapter-injector'].advanceChapter());
    assert.match((await vars()).current_chapter, /第二章/);
    await page.evaluate(() => window['novel-chapter-injector'].jumpToIndex(1));
    assert.match((await vars()).current_chapter, /第一章/);
    assert.equal(requests.length, 8);
    results.push('本地TXT自动分章、首段注入、推进、跳转回归通过');
    await change('nci-source', 'remote');
    await page.locator('#nci-remote-refresh').evaluate((button) => button.click());
    await page.waitForFunction(() => document.getElementById('nci-remote-status').textContent.includes('已获取并注入'));
    const stored = (await vars()).current_chapter;
    await change('nci-source', 'local');
    assert.match((await vars()).current_chapter, /第一章/);
    await change('nci-source', 'remote');
    assert.equal((await vars()).current_chapter, stored);
    results.push('本地与远程模式来回切换分别恢复内容与进度');
    const saving = page.waitForResponse((response) => response.url().endsWith('/api/settings/save') && response.status() === 200);
    await page.evaluate(() => window.SillyTavern.getContext().saveSettingsDebounced());
    await saving;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.getElementById('nci-source'));
    await page.evaluate(() => new Promise((resolve) => {
      const ctx = window.SillyTavern.getContext();
      ctx.eventSource.on(ctx.eventTypes.APP_READY, resolve);
    }));
    await page.evaluate(async () => {
      const ctx = window.SillyTavern.getContext();
      await ctx.selectCharacterById(ctx.characters.findIndex((c) => c.name === 'Client Test'));
    });
    await page.waitForFunction(() => window.SillyTavern.getContext().chatMetadata.variables?.current_chapter?.length === 8000)
      .catch(async (error) => {
        console.log('reload-state', await page.evaluate(() => {
          const ctx = window.SillyTavern.getContext();
          return { id: ctx.chatId, character: ctx.characterId, metaKeys: Object.keys(ctx.chatMetadata),
            vars: Object.fromEntries(Object.entries(ctx.chatMetadata.variables || {}).map(([key, value]) => [key, String(value).length])),
            settings: { mode: ctx.extensionSettings['novel-chapter-injector'].sourceMode },
            status: document.getElementById('nci-remote-status').textContent,
            dialogs: [...document.querySelectorAll('dialog[open]')].map((el) => el.textContent.slice(0, 200)) };
        }));
        throw error;
      });
    assert.equal(await page.locator('#nci-source').inputValue(), 'remote');
    assert.equal(await page.locator('[data-nci-variable]').count(), 5);
    assert.equal((await vars()).current_chapter, stored);
    results.push('刷新酒馆后设置及聊天片段恢复，未被本地小说恢复逻辑覆盖');
    assert.deepEqual(errors, []);
    const output = process.env.ST_TEST_REPORT || path.resolve('browser-validation.json');
    await fs.writeFile(output, JSON.stringify({ results, errors, requestCount: requests.length }, null, 2));
    console.log(JSON.stringify({ results, errors, requestCount: requests.length }));
  } finally { await browser.close(); }
})().catch((error) => { console.error(error.stack?.slice(0, 1500) || error.message); process.exitCode = 1; });
