// 作者：wwj
import { getContentVariableNames, readContentVariable, fillMissingContentVariables, writeContentVariables } from './content-variables.js';

// 快照属于当前聊天；切换来源时恢复其上一次注入内容，不推进本地进度。
export function switchContentSource(context, settings, nextMode) {
  if (!['local', 'remote'].includes(nextMode)) return false;
  const chatId = context.getCurrentChatId?.() ?? context.chatId;
  const metadata = context.chatMetadata;
  if (chatId != null && chatId !== '' && metadata) {
    const previousMode = metadata.nciActiveSource
      || (['local', 'remote'].includes(settings.sourceMode) ? settings.sourceMode : 'local');
    const vars = metadata.variables ??= {};
    if (previousMode === nextMode) {
      settings.sourceMode = nextMode;
      return fillMissingContentVariables(vars, settings);
    }
    const snapshots = metadata.nciContentSources ??= {};
    const names = getContentVariableNames(settings);
    const { indexVariableName: indexName } = settings;
    snapshots[previousMode] = {
      text: readContentVariable(vars, settings) || null,
      index: typeof vars[indexName] === 'string' ? vars[indexName] : null,
    };
    const next = snapshots[nextMode];
    // 旧版快照的 name/indexName 不再限制恢复目标；正文始终属于此聊天及此来源。
    if (typeof next?.text === 'string') writeContentVariables(vars, settings, next.text);
    else for (const name of names) delete vars[name];
    if (indexName && !names.includes(indexName)) {
      if (typeof next?.index === 'string') vars[indexName] = next.index;
      else delete vars[indexName];
    }
    metadata.nciActiveSource = nextMode;
  }
  settings.sourceMode = nextMode;
  return Boolean(metadata && chatId != null && chatId !== '');
}
