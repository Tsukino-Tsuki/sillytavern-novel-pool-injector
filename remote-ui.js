// 作者：wwj
import { parseTokenInput, validateChars } from './remote-api.js';
import { switchContentSource } from './source-state.js';

export function createRemoteUi({ getSettings, persistSettings, controller, onModeChange, status }) {
  const byId = (id) => document.getElementById(id);
  let loading = false;

  function setBusy(value) {
    loading = value;
    for (const id of ['nci-remote-refresh', 'nci-next', 'nci-inject-btn']) {
      const button = byId(id);
      if (button) button.disabled = value && getSettings().sourceMode === 'remote';
    }
    byId('nci-remote-status')?.setAttribute('aria-busy', String(value));
  }

  function syncVisibility() {
    const remote = getSettings().sourceMode === 'remote';
    document.querySelectorAll('#nci-drawer [data-nci-local]').forEach((el) => { el.hidden = remote; });
    document.querySelectorAll('#nci-drawer [data-nci-remote]').forEach((el) => { el.hidden = !remote; });
    const autoLabel = byId('nci-auto-label');
    const autoDescription = byId('nci-auto-description');
    if (autoLabel) autoLabel.textContent = remote ? '生成前自动获取新片段' : '请求完成后自动推进';
    if (autoDescription) autoDescription.textContent = remote
      ? '普通生成、重新生成及切换回复前获取新片段；继续生成沿用当前片段。'
      : '生成结束后自动把下一段写入变量。';
    const next = byId('nci-next');
    if (next) next.textContent = remote ? '获取并注入新片段' : '手动注入下一段';
    const button = byId('nci-inject-btn');
    if (button) button.textContent = remote ? '获取新片段' : '注入下一段';
    setBusy(loading);
  }

  function populate() {
    const s = getSettings();
    for (const [id, key] of [
      ['nci-source', 'sourceMode'], ['nci-remote-base', 'remoteBaseUrl'],
      ['nci-remote-token', 'remoteToken'], ['nci-remote-chars', 'remoteChars'],
      ['nci-remote-transport', 'remoteTransport'],
    ]) if (byId(id)) byId(id).value = String(s[key]);
  }

  function bind() {
    populate();
    byId('nci-source')?.addEventListener('change', async (event) => {
      controller.cancel();
      const context = window.SillyTavern.getContext();
      const changedChat = switchContentSource(context, getSettings(), event.target.value);
      persistSettings();
      syncVisibility();
      onModeChange();
      if (getSettings().sourceMode === 'remote') controller.chatChanged();
      if (changedChat) {
        try { await context.saveMetadata(); }
        catch { status('已切换来源，但保存聊天失败；刷新后可能丢失本次切换'); }
      }
    });
    for (const [id, key] of [
      ['nci-remote-base', 'remoteBaseUrl'], ['nci-remote-token', 'remoteToken'],
      ['nci-remote-chars', 'remoteChars'], ['nci-remote-transport', 'remoteTransport'],
    ]) {
      byId(id)?.addEventListener('change', (event) => {
        controller.cancel();
        const s = getSettings();
        s[key] = event.target.value.trim();
        try {
          if (key === 'remoteToken' && s[key]) Object.assign(s, parseTokenInput(s[key]));
          if (key === 'remoteChars') s[key] = validateChars(s[key]);
          status('设置已保存，下一次获取时生效');
        } catch (error) { status(error.message); }
        persistSettings();
        populate();
      });
    }
    byId('nci-remote-refresh')?.addEventListener('click', () => controller.refresh());
    byId('nci-remote-show')?.addEventListener('change', (event) => {
      byId('nci-remote-token').type = event.target.checked ? 'text' : 'password';
    });
    syncVisibility();
  }

  return { bind, syncVisibility, setBusy };
}
