import test from 'node:test';
import assert from 'node:assert/strict';
import { switchContentSource } from '../source-state.js';
import { migrateContentVariables } from '../content-variables.js';

test('本地与远程来回切换分别恢复正文及进度，不串来源', () => {
  const settings = { sourceMode: 'local', variableName: 'text', indexVariableName: 'index' };
  const context = { chatId: 'A', chatMetadata: { variables: { text: '本地A', index: '3' } } };
  switchContentSource(context, settings, 'remote');
  assert.equal(context.chatMetadata.variables.text, undefined);
  context.chatMetadata.variables.text = '远程B';
  context.chatMetadata.variables.index = '1';
  switchContentSource(context, settings, 'local');
  assert.deepEqual(context.chatMetadata.variables, { text: '本地A', index: '3' });
  switchContentSource(context, settings, 'remote');
  assert.deepEqual(context.chatMetadata.variables, { text: '远程B', index: '1' });
});

test('快照随聊天隔离，无聊天时只改来源设置', () => {
  const settings = { sourceMode: 'remote', variableName: 'text', indexVariableName: 'index' };
  const context = { chatId: 'B', chatMetadata: { variables: {} } };
  switchContentSource(context, settings, 'local');
  assert.equal(context.chatMetadata.variables.text, undefined);
  const empty = { chatMetadata: { variables: { text: '不应写入' } } };
  switchContentSource(empty, settings, 'remote');
  assert.equal(settings.sourceMode, 'remote');
  assert.equal(empty.chatMetadata.variables.text, '不应写入');
  assert.equal(empty.chatMetadata.nciContentSources, undefined);
});

test('在另一聊天切换了全局来源，回来仍按本聊天来源快照恢复', () => {
  const settings = { sourceMode: 'local', variableName: 'text', indexVariableName: 'index' };
  const context = { chatId: 'A', chatMetadata: { nciActiveSource: 'remote',
    variables: { text: '远程A', index: '8' },
    nciContentSources: { local: { name: 'text', indexName: 'index', text: '本地A', index: '2' } } } };
  switchContentSource(context, settings, settings.sourceMode);
  assert.deepEqual(context.chatMetadata.variables, { text: '本地A', index: '2' });
  assert.equal(context.chatMetadata.nciContentSources.remote.text, '远程A');
  assert.equal(context.chatMetadata.nciActiveSource, 'local');
});

test('旧版单变量聊天升级后补齐三变量，不改变正文、来源和进度', () => {
  const settings = { variableName: 'custom', indexVariableName: 'index', sourceMode: 'remote' };
  const context = { chatId: 'A', chatMetadata: { nciActiveSource: 'remote', variables: { custom: '远程旧正文', index: '4' } } };
  migrateContentVariables(settings);
  assert.equal(switchContentSource(context, settings, 'remote'), true);
  for (const name of settings.variableNames) assert.equal(context.chatMetadata.variables[name], '远程旧正文');
  assert.equal(context.chatMetadata.variables.index, '4');
  assert.equal(switchContentSource(context, settings, 'remote'), false);
});

test('旧单变量快照恢复到所有新目标，改名扩展后仍按来源恢复', () => {
  const settings = { variableNames: ['a', 'b', 'c'], indexVariableName: 'index', sourceMode: 'remote' };
  const context = { chatId: 'A', chatMetadata: {
    nciActiveSource: 'remote', variables: { a: '远程', b: '远程', c: '远程', index: '4' },
    nciContentSources: { local: { name: 'a', indexName: 'index', text: '本地', index: '2' } },
  } };
  switchContentSource(context, settings, 'local');
  assert.deepEqual(context.chatMetadata.variables, { a: '本地', b: '本地', c: '本地', index: '2' });
  settings.variableNames.push('d', 'e');
  switchContentSource(context, settings, 'remote');
  for (const name of settings.variableNames) assert.equal(context.chatMetadata.variables[name], '远程');
  settings.variableNames[0] = 'renamed';
  switchContentSource(context, settings, 'local');
  for (const name of settings.variableNames) assert.equal(context.chatMetadata.variables[name], '本地');
  assert.equal(context.chatMetadata.variables.index, '2');
});

test('切到无片段的来源会清理所有目标，不把其他来源正文作为旧内容', () => {
  const settings = { variableNames: ['a', 'b', 'c', 'd', 'e'], indexVariableName: 'index', sourceMode: 'local' };
  const context = { chatId: 'A', chatMetadata: { variables: Object.fromEntries(settings.variableNames.map((name) => [name, '本地'])) } };
  switchContentSource(context, settings, 'remote');
  assert.deepEqual(context.chatMetadata.variables, {});
});
