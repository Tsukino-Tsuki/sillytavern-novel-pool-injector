// 作者：wwj
// 快照属于当前聊天；切换来源时恢复其上一次注入内容，不推进本地进度。
export function switchContentSource(context, settings, nextMode) {
  if (!['local', 'remote'].includes(nextMode)) return false;
  const chatId = context.getCurrentChatId?.() ?? context.chatId;
  const metadata = context.chatMetadata;
  if (chatId != null && chatId !== '' && metadata) {
    const previousMode = metadata.nciActiveSource || (metadata.nciRemoteCount ? 'remote' : 'local');
    if (previousMode === nextMode) { settings.sourceMode = nextMode; return false; }
    const vars = metadata.variables ??= {};
    const snapshots = metadata.nciContentSources ??= {};
    const { variableName: name, indexVariableName: indexName } = settings;
    snapshots[previousMode] = {
      name, indexName,
      text: typeof vars[name] === 'string' ? vars[name] : null,
      index: typeof vars[indexName] === 'string' ? vars[indexName] : null,
    };
    const next = snapshots[nextMode];
    if (next?.name === name && next.text !== null) vars[name] = next.text;
    else delete vars[name];
    if (indexName && indexName !== name) {
      if (next?.indexName === indexName && next.index !== null) vars[indexName] = next.index;
      else delete vars[indexName];
    }
    metadata.nciActiveSource = nextMode;
  }
  settings.sourceMode = nextMode;
  return Boolean(metadata && chatId != null && chatId !== '');
}
