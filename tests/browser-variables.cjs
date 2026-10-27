// 作者：wwj；仅操作隔离测试实例的合成设置及聊天。
const assert = require('node:assert/strict');

async function prepareVariables(page, change, results) {
  // 模拟 0.3.0 自定义单变量配置，验证实际初始化迁移。
  await page.evaluate(() => {
    const ctx = window.SillyTavern.getContext();
    const settings = ctx.extensionSettings['novel-chapter-injector'];
    delete settings.variableNames;
    settings.variableName = 'legacy_chapter';
    settings.indexVariableName = 'current_chapter_index';
    settings.sourceMode = 'remote';
    ctx.chatMetadata.nciActiveSource = 'remote';
    ctx.chatMetadata.nciRemoteCount = 2;
    ctx.chatMetadata.nciContentSources = {};
    ctx.chatMetadata.variables = { legacy_chapter: '升级前的旧片段', current_chapter_index: '2' };
    window['novel-chapter-injector'].init();
  });
  await page.waitForFunction(() => document.getElementById('nci-var')?.value === 'legacy_chapter'
    && document.getElementById('nci-source')?.value === 'remote');
  assert.equal(await page.locator('[data-nci-variable]').count(), 3);
  assert.equal(await page.locator('#nci-var-2').inputValue(), 'current_chapter_2');
  assert.equal(await page.locator('#nci-var-3').inputValue(), 'current_chapter_3');
  const values = await page.evaluate(() => {
    const ctx = window.SillyTavern.getContext();
    return ctx.extensionSettings['novel-chapter-injector'].variableNames.map((name) => ctx.chatMetadata.variables[name]);
  });
  assert.deepEqual(values, Array(3).fill('升级前的旧片段'));
  await change('nci-var', 'current_chapter');
  for (const invalid of ['', 'current_chapter', 'current_chapter_index']) {
    await change('nci-var-2', invalid);
    assert.equal(await page.locator('#nci-var-2').inputValue(), 'current_chapter_2');
    assert.match(await page.locator('#nci-variable-status').textContent(), /已保留原设置/);
  }
  await change('nci-idxvar', 'current_chapter_3');
  assert.equal(await page.locator('#nci-idxvar').inputValue(), 'current_chapter_index');
  results.push('旧版自定义单变量自动迁移为3个并补齐旧正文；空名、重名与进度冲突被拒绝');
}

async function expandVariables(page, results) {
  const add = () => page.locator('#nci-add-variable').evaluate((button) => button.click());
  await add();
  await add();
  assert.equal(await page.locator('[data-nci-variable]').count(), 5);
  assert.equal(await page.locator('#nci-add-variable').isDisabled(), true);
  await page.locator('.nci-remove-variable').last().evaluate((button) => button.click());
  assert.equal(await page.locator('[data-nci-variable]').count(), 4);
  assert.equal(await page.locator('#nci-add-variable').isDisabled(), false);
  await add();
  assert.equal(await page.locator('[data-nci-variable]').count(), 5);
  results.push('面板可扩展至5个、达到上限禁用添加，移除后可重新添加');
}

async function readSynchronizedVariables(page) {
  const { vars, names, macros } = await page.evaluate(() => {
    const ctx = window.SillyTavern.getContext();
    const names = ctx.extensionSettings['novel-chapter-injector'].variableNames;
    return { vars: ctx.chatMetadata.variables, names,
      macros: names.map((name) => ctx.substituteParams(`{{getvar::${name}}}`)) };
  });
  for (const name of names) assert.equal(vars[name], vars[names[0]], `正文不同: ${name}`);
  for (const macro of macros) assert.equal(macro, vars[names[0]]);
  return vars;
}

module.exports = { prepareVariables, expandVariables, readSynchronizedVariables };
