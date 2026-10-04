// Probe the bundled Web Forms application, rather than the retired Enketo service.
const http = require('node:http');
const request = (url, method = 'GET') => new Promise((resolve) => {
  let settled = false;
  const finish = value => { if (!settled) { settled = true; resolve(value); } };
  const req = http.request(url, { method, timeout: 1500 }, res => {
    const chunks = []; let size = 0;
    res.on('data', chunk => {
      size += chunk.length;
      if (size > 128 * 1024) { finish(null); res.destroy(); } else chunks.push(chunk);
    });
    res.on('error', () => finish(null));
    res.on('end', () => finish({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
  });
  req.on('error', () => finish(null));
  req.on('timeout', () => { finish(null); req.destroy(); });
  req.end();
});
const webFormsHealth = async (origin = 'http://127.0.0.1:8080') => {
  const page = await request(new URL('/apps/forms/index.html', origin));
  if (page?.status !== 200 || !/text\/html/i.test(page.headers['content-type'] || '') || !/<title>[^<]*Web Forms<\/title>/i.test(page.body)) return false;
  const scripts = Array.from(page.body.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/gi), match => match[1]);
  if (!scripts.some(src => /^\/assets\/forms\/[^/]+\.js$/.test(src))) return false;
  const assets = await Promise.all(scripts.map(async src => {
    // Never follow external script URLs or redirects from this local probe.
    if (!/^\/(?:assets\/forms\/|apps\/forms\/)[a-z0-9_./-]+\.js$/i.test(src) || src.includes('..')) return false;
    const result = await request(new URL(src, origin), 'HEAD');
    return result?.status === 200 && /(?:javascript|ecmascript)/i.test(result.headers['content-type'] || '') && result.headers['content-length'] !== '0';
  }));
  return assets.length > 0 && assets.every(Boolean);
};
module.exports = { webFormsHealth };
