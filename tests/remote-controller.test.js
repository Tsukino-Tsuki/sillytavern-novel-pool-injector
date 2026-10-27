import test from 'node:test';
import assert from 'node:assert/strict';
import { createRemoteController } from '../remote-controller.js';
import { REMOTE_DEFAULTS } from '../remote-api.js';

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function harness(request) {
  const settings = { ...REMOTE_DEFAULTS, sourceMode: 'remote', remoteToken: 'a'.repeat(43),
    variableName: 'current_chapter', indexVariableName: 'current_chapter_index', autoAdvance: true, manualMode: false };
  let saved = 0;
  let groupGenerating = false;
  let context = {
    chatId: 'A', characterId: 1, groupId: null, chatMetadata: { variables: { current_chapter: '旧片段' } },
    saveMetadata: async () => { saved++; }, getRequestHeaders: () => ({}),
  };
  const notices = [], statuses = [], previews = [], loading = [];
  const controller = createRemoteController({
    getContext: () => context, getSettings: () => settings, request,
    status: (value) => statuses.push(value), preview: (value) => previews.push(value),
    busy: (value) => loading.push(value), notify: (value) => notices.push(value),
    isGroupGenerating: () => groupGenerating,
  });
  return { controller, settings, notices, statuses, previews, loading,
    get context() { return context; }, set context(value) { context = value; },
    get saved() { return saved; }, set groupGenerating(value) { groupGenerating = value; } };
}

test('生成前必须等待请求完成，成功才覆盖变量并保存', async () => {
  const pending = deferred();
  const h = harness(() => pending.promise);
  let complete = false;
  const generate = h.controller.beforeGeneration('normal').then(() => { complete = true; });
  await Promise.resolve();
  assert.equal(complete, false);
  assert.equal(h.context.chatMetadata.variables.current_chapter, '旧片段');
  pending.resolve({ text: '新片段', chars: 8000 });
  await generate;
  assert.equal(h.context.chatMetadata.variables.current_chapter, '新片段');
  assert.equal(h.context.chatMetadata.variables.current_chapter_index, '1');
  assert.equal(h.saved, 1);
  assert.equal(h.loading.at(-1), false);
});

test('普通、重新生成、swipe刷新；continue、quiet、dryRun不请求', async () => {
  let calls = 0;
  const h = harness(async () => { calls++; return { text: '新', chars: 8000 }; });
  for (const type of ['normal', 'regenerate', 'swipe', undefined, 'impersonate']) await h.controller.beforeGeneration(type);
  assert.equal(calls, 5);
  for (const type of ['continue', 'quiet']) await h.controller.beforeGeneration(type);
  await h.controller.beforeGeneration('normal', {}, true);
  assert.equal(calls, 5);
  h.settings.manualMode = true;
  await h.controller.beforeGeneration('normal');
  h.settings.manualMode = false;
  h.settings.autoAdvance = false;
  await h.controller.beforeGeneration('normal');
  h.settings.sourceMode = 'local';
  await h.controller.beforeGeneration('normal');
  assert.equal(calls, 5);
});

test('最终失败保留旧内容且只提示一次，无旧内容时明确提示但继续', async () => {
  const h = harness(async () => { throw new Error('读取失败'); });
  await h.controller.beforeGeneration('normal');
  assert.equal(h.context.chatMetadata.variables.current_chapter, '旧片段');
  assert.equal(h.saved, 0);
  assert.equal(h.notices.length, 1);
  assert.match(h.notices[0], /沿用/);
  delete h.context.chatMetadata.variables.current_chapter;
  await h.controller.beforeGeneration('normal');
  assert.match(h.notices[1], /没有旧内容/);
  assert.equal(h.context.chatMetadata.variables.current_chapter, undefined);
});

test('手动与自动同时触发合并在途请求', async () => {
  const pending = deferred();
  let calls = 0;
  const h = harness(() => { calls++; return pending.promise; });
  const first = h.controller.refresh();
  const second = h.controller.refresh();
  const generation = h.controller.beforeGeneration('normal');
  assert.equal(first, second);
  assert.equal(calls, 1);
  pending.resolve({ text: '新', chars: 8000 });
  await Promise.all([first, generation]);
  assert.equal(h.saved, 1);
});

test('切换聊天即使名称相同，也不写入新聊天或旧聊天', async () => {
  const pending = deferred();
  const h = harness(() => pending.promise);
  const old = h.context.chatMetadata;
  const loading = h.controller.refresh();
  h.context = { ...h.context, characterId: 2, chatMetadata: { variables: { current_chapter: '另一个聊天' } } };
  pending.resolve({ text: '不该写入', chars: 8000 });
  await loading;
  assert.equal(old.variables.current_chapter, '旧片段');
  assert.equal(h.context.chatMetadata.variables.current_chapter, '另一个聊天');
  assert.equal(h.saved, 0);
  assert.equal(h.notices.length, 0);
});

test('修改地址、模式或变量名后丢弃之前的响应', async () => {
  for (const [key, value] of [['remoteBaseUrl', 'https://other.example'], ['sourceMode', 'local'], ['variableName', 'new_name']]) {
    const pending = deferred();
    const h = harness(() => pending.promise);
    const loading = h.controller.refresh();
    h.settings[key] = value;
    pending.resolve({ text: '不该写入', chars: 8000 });
    await loading;
    assert.equal(h.context.chatMetadata.variables.current_chapter, '旧片段');
    assert.equal(h.saved, 0);
  }
});

test('停止或外部AbortSignal取消后不写入、不弹失败提示', async () => {
  const pending = deferred();
  const h = harness(() => pending.promise);
  const abort = new AbortController();
  const loading = h.controller.beforeGeneration('normal', { signal: abort.signal });
  abort.abort();
  pending.resolve({ text: '不该写入', chars: 8000 });
  await loading;
  assert.equal(h.saved, 0);
  assert.equal(h.notices.length, 0);
  assert.equal(h.loading.at(-1), false);
});

test('群聊外层不抓取，实际成员生成时抓取，自动continue不抓取', async () => {
  let calls = 0;
  const h = harness(async () => { calls++; return { text: '新', chars: 8000 }; });
  h.context.groupId = 'group';
  await h.controller.beforeGeneration('normal');
  assert.equal(calls, 0);
  h.groupGenerating = true;
  await h.controller.beforeGeneration('normal');
  await h.controller.beforeGeneration('continue');
  assert.equal(calls, 1);
});

test('无聊天不请求，正文与进度变量重名不覆盖', async () => {
  let calls = 0;
  const h = harness(async () => { calls++; return { text: '新', chars: 8000 }; });
  h.context.chatId = undefined;
  await h.controller.refresh();
  assert.equal(calls, 0);
  h.context.chatId = 'A';
  h.settings.indexVariableName = 'current_chapter';
  await h.controller.refresh();
  assert.equal(calls, 0);
  assert.equal(h.context.chatMetadata.variables.current_chapter, '旧片段');
});

test('保存失败不重复请求，当前正文仍可用并明确提醒', async () => {
  let calls = 0;
  const h = harness(async () => { calls++; return { text: '新', chars: 8000 }; });
  h.context.saveMetadata = async () => { throw new Error('保存失败'); };
  await h.controller.refresh();
  assert.equal(calls, 1);
  assert.equal(h.context.chatMetadata.variables.current_chapter, '新');
  assert.match(h.notices[0], /保存聊天失败/);
});

test('三个及五个变量只获取一次、统一写入且成功计数只加一次', async () => {
  for (const count of [3, 5]) {
    let calls = 0;
    const h = harness(async () => { calls++; return { text: '同一片段', chars: 8000 }; });
    h.settings.variableNames = ['current_chapter', ...Array.from({ length: count - 1 }, (_, i) => `novel_${i}`)];
    await h.controller.refresh();
    assert.equal(calls, 1);
    assert.equal(h.saved, 1);
    assert.equal(h.context.chatMetadata.nciRemoteCount, 1);
    for (const name of h.settings.variableNames) assert.equal(h.context.chatMetadata.variables[name], '同一片段');
  }
});

test('多变量请求失败保留全部原值，第一变量缺失时仍识别其他旧正文', async () => {
  const h = harness(async () => { throw new Error('读取失败'); });
  h.settings.variableNames = ['current_chapter', 'second', 'third', 'fourth', 'fifth'];
  const vars = { second: '旧二', third: '旧三', fourth: '旧四', fifth: '旧五' };
  h.context.chatMetadata.variables = { ...vars };
  await h.controller.refresh();
  assert.deepEqual(h.context.chatMetadata.variables, vars);
  assert.equal(h.saved, 0);
  assert.equal(h.previews.at(-1), '旧二');
  assert.match(h.notices[0], /沿用/);
});

test('在途请求的第二变量改名或添加第五变量，旧响应不能写入任何目标', async () => {
  for (const mutate of [(names) => { names[1] = 'renamed'; }, (names) => { names.push('fifth'); }]) {
    const pending = deferred();
    const h = harness(() => pending.promise);
    h.settings.variableNames = ['current_chapter', 'second', 'third', 'fourth'];
    const loading = h.controller.refresh();
    mutate(h.settings.variableNames);
    pending.resolve({ text: '过期', chars: 8000 });
    await loading;
    assert.deepEqual(h.context.chatMetadata.variables, { current_chapter: '旧片段' });
    assert.equal(h.saved, 0);
  }
});

test('任意正文变量与进度冲突或正文重名时不发出请求', async () => {
  let calls = 0;
  const h = harness(async () => { calls++; return { text: '新', chars: 8000 }; });
  for (const names of [['current_chapter', 'second', 'current_chapter_index'], ['current_chapter', 'second', 'second']]) {
    h.settings.variableNames = names;
    await h.controller.refresh();
    assert.equal(calls, 0);
    assert.deepEqual(h.context.chatMetadata.variables, { current_chapter: '旧片段' });
  }
});
