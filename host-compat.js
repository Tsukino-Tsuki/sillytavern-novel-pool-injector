// 作者：wwj

/**
 * TauriTavern 没有 SillyTavern 的 /api/search/visit 兼容接口。
 * 它提供稳定的宿主标记，插件据此自动改用小说服务的 CORS GET。
 */
export function isTauriTavernHost(host = globalThis) {
  return host?.__TAURI_RUNNING__ === true
    || Boolean(host?.__TAURITAVERN_HOST__)
    || Boolean(host?.__TAURITAVERN__?.api);
}

export function resolveRemoteSettings(settings, host = globalThis) {
  const effective = { ...settings };
  if (isTauriTavernHost(host)) effective.remoteTransport = 'direct';
  return effective;
}
