import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REMOTE_DEFAULTS, parseTokenInput, buildExcerptUrl, fetchExcerpt, countCharacters, waitForRetry,
} from '../remote-api.js';

const token = 'a'.repeat(43);
const settings = { ...REMOTE_DEFAULTS, sourceMode: 'remote', remoteToken: token };
const goodText = '文'.repeat(7998) + '😀\n\t字';
const goodResponse = () => new Response(goodText, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

test('完整链接提取地址、子路径、令牌与字数，裸令牌保留原地址设置', () => {
  assert.deepEqual(parseTokenInput(`https://example.com/pool/v1/excerpt/${token}?chars=15000`), {
    remoteBaseUrl: 'https://example.com/pool', remoteToken: token, remoteChars: 15000,
  });
  assert.deepEqual(parseTokenInput(token), { remoteToken: token });
  assert.equal(buildExcerptUrl({ ...settings, remoteBaseUrl: 'https://example.com/pool/' }),
    `https://example.com/pool/v1/excerpt/${token}?chars=8000`);
});

test('参数边界及旧token计数链接拒绝，不静默截断字数', () => {
  for (const chars of [7999, 32001, 8000.5, '', 'abc']) {
    assert.throws(() => buildExcerptUrl({ ...settings, remoteChars: chars }));
  }
  for (const chars of [8000, 15000, 32000]) {
    assert.match(buildExcerptUrl({ ...settings, remoteChars: chars }), new RegExp(`chars=${chars}$`));
  }
  assert.throws(() => parseTokenInput(`https://example.com/v1/excerpt/${token}?tokens=8000`), /tokens/);
  assert.throws(() => parseTokenInput(`https://example.com/v1/excerpt/${token}?chars=8000&chars=9000`));
  for (const base of ['javascript:alert(1)', 'ftp://example.com', 'https://u:p@example.com', 'https://example.com/?a=b']) {
    assert.throws(() => buildExcerptUrl({ ...settings, remoteBaseUrl: base }));
  }
});

test('酒馆默认读取无需代理开关，不发送IP、localhost或非标准端口', () => {
  for (const base of ['http://127.0.0.1', 'http://localhost', 'http://[::1]', 'https://example.com:8080']) {
    assert.throws(() => buildExcerptUrl({ ...settings, remoteBaseUrl: base }), /公共域名/);
  }
});

test('Unicode非空白码点计数与服务端Python口径一致', () => {
  assert.equal(countCharacters(goodText), 8000);
  assert.equal(countCharacters('中😀e\u0301\ufeff\u0085\u001c\u3000\n'), 5);
});

test('默认通过酒馆POST html:false，正文原样返回', async () => {
  let calls = 0;
  const result = await fetchExcerpt(settings, {
    getRequestHeaders: () => ({ 'X-CSRF-Token': 'synthetic-csrf', 'Content-Type': 'application/json' }),
    fetchImpl: async (url, init) => {
      calls++;
      assert.equal(url, '/api/search/visit');
      assert.equal(init.method, 'POST');
      assert.equal(init.credentials, 'same-origin');
      assert.equal(init.headers['X-CSRF-Token'], 'synthetic-csrf');
      assert.deepEqual(JSON.parse(init.body), { url: buildExcerptUrl(settings), html: false });
      return goodResponse();
    },
  });
  assert.equal(result.text, goodText);
  assert.equal(calls, 1);
});

test('浏览器直连不携带酒馆CSRF或cookies', async () => {
  await fetchExcerpt({ ...settings, remoteTransport: 'direct' }, {
    getRequestHeaders: () => { throw new Error('不应读取酒馆凭据'); },
    fetchImpl: async (url, init) => {
      assert.equal(url, buildExcerptUrl(settings));
      assert.equal(init.method, 'GET');
      assert.equal(init.credentials, 'omit');
      assert.deepEqual(init.headers, { Accept: 'text/plain' });
      assert.equal(init.body, undefined);
      return goodResponse();
    },
  });
});

test('首次失败后恰好重试3次，每次等待1000ms，最后一次成功', async () => {
  let calls = 0;
  const waits = [];
  const attempts = [];
  const result = await fetchExcerpt(settings, {
    fetchImpl: async () => ++calls < 4 ? new Response('Internal Server Error', { status: 500 }) : goodResponse(),
    sleep: async (ms) => { waits.push(ms); },
    onAttempt: (attempt) => attempts.push(attempt),
  });
  assert.equal(result.text, goodText);
  assert.equal(calls, 4);
  assert.deepEqual(waits, [1000, 1000, 1000]);
  assert.deepEqual(attempts, [1, 2, 3, 4]);
});

test('持续失败、空正文、错字数、HTML均不作为成功内容', async () => {
  for (const response of [
    () => new Response('Internal Server Error', { status: 500 }),
    () => new Response('', { headers: { 'Content-Type': 'text/plain' } }),
    () => new Response('短正文', { headers: { 'Content-Type': 'text/plain' } }),
    () => new Response('文'.repeat(8000), { headers: { 'Content-Type': 'text/html' } }),
  ]) {
    let calls = 0;
    await assert.rejects(fetchExcerpt(settings, {
      fetchImpl: async () => { calls++; return response(); }, sleep: async () => {},
    }));
    assert.equal(calls, 4);
  }
});

test('纯文本正文中出现技术错误词仍正常接收', async () => {
  const prefix = 'Cloudflare 502 bad gateway error';
  const body = prefix + '文'.repeat(8000 - countCharacters(prefix));
  const result = await fetchExcerpt(settings, {
    fetchImpl: async () => new Response(body, { headers: { 'Content-Type': 'text/plain' } }),
  });
  assert.equal(result.text, body);
});

test('取消等待不会再发请求，非法配置不发请求', async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(fetchExcerpt(settings, {
    signal: controller.signal,
    fetchImpl: async () => { calls++; throw new TypeError('Failed to fetch'); },
    sleep: async () => { controller.abort(); },
  }), { name: 'AbortError' });
  assert.equal(calls, 1);
  await assert.rejects(fetchExcerpt({ ...settings, remoteToken: '' }, {
    fetchImpl: async () => { throw new Error('不应发请求'); },
  }), /令牌/);
  const stopped = new AbortController();
  stopped.abort();
  await assert.rejects(waitForRetry(1000, stopped.signal), { name: 'AbortError' });
});

test('单次超时会取消请求且总次数有界', async () => {
  let calls = 0;
  await assert.rejects(fetchExcerpt(settings, {
    timeoutMs: 5, sleep: async () => {},
    fetchImpl: async (_url, init) => {
      calls++;
      return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => {
        reject(new DOMException('aborted', 'AbortError'));
      }, { once: true }));
    },
  }), /超时/);
  assert.equal(calls, 4);
});
