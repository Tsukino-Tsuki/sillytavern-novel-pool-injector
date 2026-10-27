// 作者：wwj
import test from 'node:test';
import assert from 'node:assert/strict';
import { isTauriTavernHost, resolveRemoteSettings } from '../host-compat.js';

test('只识别 TauriTavern 对外宿主标记', () => {
  assert.equal(isTauriTavernHost({}), false);
  assert.equal(isTauriTavernHost({ __TAURI_RUNNING__: true }), true);
  assert.equal(isTauriTavernHost({ __TAURITAVERN_HOST__: { platform: 'windows', kind: 'desktop' } }), true);
  assert.equal(isTauriTavernHost({ __TAURITAVERN__: { api: {} } }), true);
  assert.equal(isTauriTavernHost({ __TAURI_RUNNING__: false, __TAURITAVERN_HOST__: null }), false);
});

test('TT 自动使用浏览器直连，不改写已保存的普通酒馆设置', () => {
  const stored = { remoteTransport: 'tavern', remoteChars: 8000 };
  const effective = resolveRemoteSettings(stored, { __TAURI_RUNNING__: true });
  assert.equal(effective.remoteTransport, 'direct');
  assert.equal(stored.remoteTransport, 'tavern');
  assert.notEqual(effective, stored);

  assert.equal(resolveRemoteSettings(stored, {}).remoteTransport, 'tavern');
  assert.equal(resolveRemoteSettings({ remoteTransport: 'direct' }, { __TAURI_RUNNING__: true }).remoteTransport, 'direct');
});
