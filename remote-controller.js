// 作者：wwj
import { fetchExcerpt } from './remote-api.js';
import { getContentVariableNames, readContentVariable, validateContentVariables, writeContentVariables } from './content-variables.js';

function chatIdentity(context) {
  const id = context.getCurrentChatId?.() ?? context.chatId;
  if (id === undefined || id === null || id === '' || !context.chatMetadata) return null;
  const owner = context.groupId != null ? `group:${context.groupId}` : `character:${context.characterId}`;
  return { key: `${owner}:${id}`, metadata: context.chatMetadata };
}

function sameChat(a, b) {
  return a && b && a.key === b.key && a.metadata === b.metadata;
}

export function createRemoteController({
  getContext, getSettings, status, preview, busy, notify,
  request = fetchExcerpt, isGroupGenerating = () => true,
  onChatChanged = () => {},
}) {
  let active = null;
  const bindings = [];
  const snapshot = () => {
    const s = getSettings();
    return {
      sourceMode: s.sourceMode, remoteBaseUrl: s.remoteBaseUrl, remoteToken: s.remoteToken,
      remoteChars: s.remoteChars, remoteTransport: s.remoteTransport,
      variableNames: getContentVariableNames(s), indexVariableName: s.indexVariableName,
    };
  };

  function currentText() {
    const ctx = getContext();
    if (!chatIdentity(ctx)) return '';
    return readContentVariable(ctx.chatMetadata.variables, getSettings());
  }

  function refreshPreview() { preview(currentText()); }

  function cancel() {
    active?.controller.abort();
    active = null;
    busy(false);
  }

  async function run(job) {
    const { settings, chat, controller } = job;
    const valid = () => !controller.signal.aborted
      && sameChat(chat, chatIdentity(getContext()))
      && JSON.stringify(snapshot()) === JSON.stringify(settings);
    try {
      validateContentVariables(settings);
      const context = getContext();
      const result = await request(settings, {
        signal: controller.signal,
        getRequestHeaders: () => context.getRequestHeaders(),
        onAttempt: (attempt) => {
          if (valid()) status(attempt === 1 ? '正在获取新片段…' : `正在重试 ${attempt - 1}/3…`);
        },
      });
      if (!valid()) return false;
      const ctx = getContext();
      const vars = ctx.chatMetadata.variables ??= {};
      writeContentVariables(vars, settings, result.text);
      ctx.chatMetadata.nciActiveSource = 'remote';
      // 远程进度为本聊天成功获取次数，不使用本地章节索引。
      const previous = Number(ctx.chatMetadata.nciRemoteCount) || 0;
      ctx.chatMetadata.nciRemoteCount = previous + 1;
      if (settings.indexVariableName) vars[settings.indexVariableName] = String(previous + 1);
      refreshPreview();
      try { await ctx.saveMetadata(); }
      catch {
        if (valid()) {
          status('新片段已写入当前聊天，但保存失败；刷新页面后可能丢失');
          notify('新片段已可用于本次生成，但保存聊天失败', 'warning');
        }
        return true;
      }
      if (valid()) status(`已获取并注入 ${result.chars} 字（本聊天第 ${previous + 1} 次）`);
      return true;
    } catch (error) {
      if (!valid() || error.name === 'AbortError') return false;
      const fallback = currentText() ? '已沿用当前聊天的旧内容' : '当前聊天没有旧内容，本次将不附加小说片段';
      const message = `${error.message}；${fallback}`;
      status(message);
      notify(message, 'warning');
      refreshPreview();
      return false;
    } finally {
      if (active === job) { active = null; busy(false); }
    }
  }

  function refresh() {
    const settings = snapshot();
    const chat = chatIdentity(getContext());
    if (settings.sourceMode !== 'remote') return Promise.resolve(false);
    if (!chat) {
      status('请先打开一个聊天，再获取小说片段');
      return Promise.resolve(false);
    }
    if (active && sameChat(chat, active.chat)
      && JSON.stringify(settings) === JSON.stringify(active.settings)) return active.promise;
    cancel();
    const job = { settings, chat, controller: new AbortController(), promise: null };
    active = job;
    busy(true);
    job.promise = run(job);
    return job.promise;
  }

  async function beforeGeneration(type, options = {}, dryRun = false) {
    const settings = getSettings();
    if (dryRun || settings.sourceMode !== 'remote' || settings.manualMode || !settings.autoAdvance) return;
    if (type === 'continue' || type === 'quiet') return;
    if (getContext().groupId != null && !isGroupGenerating()) return;
    if (options.signal?.aborted) return;
    options.signal?.addEventListener('abort', cancel, { once: true });
    try { await refresh(); }
    finally { options.signal?.removeEventListener('abort', cancel); }
  }

  function chatChanged() {
    cancel();
    onChatChanged();
    if (getSettings().sourceMode !== 'remote') return;
    refreshPreview();
    status(currentText() ? '已恢复当前聊天的片段' : '当前聊天尚无片段，生成前将自动获取，或点击手动刷新');
  }

  function bind() {
    const ctx = getContext();
    const events = ctx.eventTypes || ctx.event_types;
    if (!events?.GENERATION_AFTER_COMMANDS || !ctx.eventSource?.on) {
      status('此酒馆版本缺少生成前事件，请升级至 SillyTavern 1.13.0 或更新版本');
      return;
    }
    for (const [event, handler] of [
      [events.GENERATION_AFTER_COMMANDS, beforeGeneration],
      [events.CHAT_CHANGED, chatChanged],
      [events.GENERATION_STOPPED, cancel],
    ]) {
      if (event) { ctx.eventSource.on(event, handler); bindings.push([ctx.eventSource, event, handler]); }
    }
  }

  function dispose() {
    cancel();
    for (const [source, event, handler] of bindings.splice(0)) {
      (source.removeListener || source.off).call(source, event, handler);
    }
  }

  return { refresh, cancel, refreshPreview, beforeGeneration, bind, dispose, chatChanged };
}
