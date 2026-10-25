// 作者：wwj
export const REMOTE_DEFAULTS = Object.freeze({
  sourceMode: 'local',
  remoteBaseUrl: 'https://share.2519885.dpdns.org',
  remoteToken: '',
  remoteChars: 8000,
  remoteTransport: 'tavern',
});

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const PYTHON_SPACE = /[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/u;

export function countCharacters(text) {
  let count = 0;
  for (const char of text) if (!PYTHON_SPACE.test(char)) count++;
  return count;
}

export function validateChars(value) {
  const chars = Number(value);
  if (!Number.isInteger(chars) || chars < 8000 || chars > 32000) {
    throw new Error('片段字数须为 8000～32000 的整数');
  }
  return chars;
}

function parseHttpUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('请填写完整的 http 或 https 服务网址'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('服务网址须使用 http 或 https，不能包含用户名和密码');
  }
  return url;
}

export function parseTokenInput(value) {
  const token = value.trim();
  if (TOKEN.test(token)) return { remoteToken: token };
  const url = parseHttpUrl(token);
  const match = url.pathname.match(/^(.*)\/v1\/excerpt\/([A-Za-z0-9_-]{43})\/?$/);
  if (!match) throw new Error('请粘贴网站生成的完整片段链接或 43 位访问令牌');
  if (url.searchParams.has('tokens')) throw new Error('旧链接的 tokens 参数需改为 chars');
  const lengths = url.searchParams.getAll('chars');
  if (lengths.length > 1) throw new Error('链接中只能有一个 chars 参数');
  const result = { remoteBaseUrl: url.origin + match[1], remoteToken: match[2] };
  if (lengths.length) result.remoteChars = validateChars(lengths[0]);
  return result;
}

export function buildExcerptUrl(settings) {
  const base = parseHttpUrl(settings.remoteBaseUrl.trim());
  if (base.search || base.hash) throw new Error('服务地址不能包含查询参数或片段，请把完整链接粘贴到令牌输入框');
  if (!TOKEN.test(settings.remoteToken)) throw new Error('请先填写有效的访问令牌');
  base.pathname = base.pathname.replace(/\/+$/, '') + '/v1/excerpt/' + settings.remoteToken;
  base.searchParams.set('chars', String(validateChars(settings.remoteChars)));
  if (settings.remoteTransport === 'tavern' && (
    base.port || base.hostname.includes(':') || /^\d+\.\d+\.\d+\.\d+$/.test(base.hostname)
    || base.hostname === 'localhost' || base.hostname.endsWith('.localhost')
  )) throw new Error('酒馆读取仅支持公共域名和标准端口；请使用服务的 https 域名');
  return base.href;
}

export function waitForRetry(ms, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new DOMException('已取消', 'AbortError')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
  });
}

function responseError(response, body, transport) {
  if (transport === 'tavern') {
    if (response.status === 404) return '酒馆未提供网页读取接口，请使用 SillyTavern 1.13.0 或更新版本';
    if (response.status === 403) return '酒馆拒绝读取请求，请刷新酒馆页面后重试';
    if (response.status === 400) return '酒馆拒绝此网址，请检查公共域名与端口';
    return `酒馆读取失败（HTTP ${response.status}），请检查令牌、使用资格和服务状态`;
  }
  const code = body.match(/^([A-Z][A-Z0-9_]+):/)?.[1];
  const messages = {
    INVALID_TOKEN: '访问令牌无效、已过期或已撤销',
    USER_DISABLED: '链接所有者已被停用',
    DISCORD_REAUTH_REQUIRED: '链接所有者需要重新登录网站验证 Discord',
    ROLE_REQUIRED: '链接所有者不再具备使用资格',
    RATE_LIMITED: '小说服务请求过于频繁',
    NO_ELIGIBLE_NOVEL: '小说池中暂无满足字数的小说',
    EXCERPT_BUSY: '小说服务繁忙',
    EXCERPT_TIMEOUT: '小说服务处理超时',
  };
  return messages[code] || `小说服务读取失败（HTTP ${response.status}${code ? '，' + code : ''}）`;
}

async function requestOnce(url, settings, options) {
  const { signal, fetchImpl, getRequestHeaders, timeoutMs } = options;
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
  const viaTavern = settings.remoteTransport === 'tavern';
  try {
    const response = await fetchImpl(viaTavern ? '/api/search/visit' : url, {
      method: viaTavern ? 'POST' : 'GET',
      headers: viaTavern ? getRequestHeaders() : { Accept: 'text/plain' },
      ...(viaTavern ? { body: JSON.stringify({ url, html: false }) } : {}),
      credentials: viaTavern ? 'same-origin' : 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(responseError(response, text, settings.remoteTransport));
    const mime = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    if (mime !== 'text/plain') throw new Error('返回内容不是纯文本，未覆盖旧片段，请检查服务网址');
    const chars = countCharacters(text);
    if (chars !== Number(settings.remoteChars)) throw new Error(`返回字数不匹配（${chars} / ${settings.remoteChars}），未覆盖旧片段`);
    return { text, chars };
  } catch (error) {
    if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
    if (controller.signal.aborted) throw new Error('读取片段超时');
    if (error instanceof TypeError) throw new Error('无法连接：请检查网络；浏览器直连还需要服务支持跨域');
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

export async function fetchExcerpt(settings, {
  signal, getRequestHeaders = () => ({ 'Content-Type': 'application/json' }),
  fetchImpl = globalThis.fetch, sleep = waitForRetry, timeoutMs = 20000,
  onAttempt = () => {},
} = {}) {
  const url = buildExcerptUrl(settings);
  if (!['tavern', 'direct'].includes(settings.remoteTransport)) throw new Error('未知的读取方式');
  for (let attempt = 0; attempt <= 3; attempt++) {
    signal?.throwIfAborted();
    onAttempt(attempt + 1);
    try {
      return await requestOnce(url, settings, { signal, fetchImpl, getRequestHeaders, timeoutMs });
    } catch (error) {
      if (signal?.aborted || error.name === 'AbortError' || attempt === 3) throw error;
      await sleep(1000, signal);
    }
  }
}
