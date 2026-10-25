// 作者：wwj
import { createRemoteController } from './remote-controller.js';
import { createRemoteUi } from './remote-ui.js';
import { switchContentSource } from './source-state.js';

export function createRemoteMode({ getSettings, persistSettings, onModeChange, isGroupGenerating }) {
  let ui;
  const status = (message) => {
    const el = document.getElementById('nci-remote-status');
    if (el) el.textContent = message;
  };
  const controller = createRemoteController({
    getContext: () => window.SillyTavern.getContext(),
    getSettings, status, isGroupGenerating,
    onChatChanged: () => {
      const ctx = window.SillyTavern.getContext();
      if (switchContentSource(ctx, getSettings(), getSettings().sourceMode)) {
        ctx.saveMetadata().catch(() => status('当前来源已恢复，但保存聊天失败'));
      }
    },
    preview: (text) => {
      const el = document.getElementById('nci-preview');
      if (el) el.textContent = text ? text.slice(0, 500) + (text.length > 500 ? '…' : '') : '当前聊天尚无小说片段';
    },
    busy: (value) => ui?.setBusy(value),
    notify: (message, level) => window.toastr?.[level]?.(message, '小说片段', { escapeHtml: true }),
  });
  ui = createRemoteUi({ getSettings, persistSettings, controller, onModeChange, status });
  controller.bind();
  return {
    mount: () => { ui.bind(); controller.chatChanged(); },
    updateVisibility: ui.syncVisibility,
    refresh: controller.refresh,
    preview: controller.refreshPreview,
    cancel: controller.cancel,
    dispose: controller.dispose,
  };
}
