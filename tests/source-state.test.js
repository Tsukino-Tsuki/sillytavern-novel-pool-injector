import test from 'node:test';
import assert from 'node:assert/strict';
import { switchContentSource } from '../source-state.js';

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
