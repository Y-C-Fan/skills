#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const crypto = require('crypto');

function arg(name, fallback = '') {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
function has(name) { return process.argv.includes(name); }

const url = arg('--url') || process.argv[2];
if (!url || !/^https?:\/\/mp\.weixin\.qq\.com\//.test(url)) {
  console.error('Usage: node capture_wechat_article.js --url <mp.weixin.qq.com url> [--digest] [--out-dir D:/QClaw/articles]');
  process.exit(2);
}

const outDir = arg('--out-dir', 'D:/QClaw/articles');
const tmpDir = arg('--tmp-dir', 'D:/QClaw/tmp');
const workspace = arg('--workspace', process.env.QCLAW_WORKSPACE || 'C:/Users/chaowi/.qclaw/workspace');
const now = new Date();
const timestamp = arg('--timestamp', toShanghaiIso(now));

fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(tmpDir, { recursive: true });

const UA_LIST = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 MicroMessenger/8.0.49 Safari/604.1',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
];

function fetchBuffer(targetUrl, ua, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const lib = targetUrl.startsWith('https') ? https : http;
    const req = lib.get(targetUrl, {
      timeout: timeoutMs,
      headers: {
        'User-Agent': ua,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      }
    }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        const next = new URL(res.headers.location, targetUrl).toString();
        fetchBuffer(next, ua, timeoutMs).then(resolve, reject);
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, buffer: Buffer.concat(chunks) }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

function decodeHtml(s = '') {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)));
}

function stripJsString(s = '') {
  return decodeHtml(s.replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\'/g, "'").replace(/\\"/g, '"'));
}

function pick(html, patterns) {
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1]) return stripJsString(m[1].trim());
  }
  return '';
}

function extractContentBlock(html) {
  const patterns = [
    /<div[^>]+id=["']js_content["'][\s\S]*?<\/div>\s*<script\b/i,
    /<div[^>]+id=["']js_content["'][\s\S]*?<\/div>\s*<\/div>\s*<script\b/i,
    /<div[^>]+id=["']js_content["'][\s\S]*?<\/div>/i
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return m[0].replace(/<script\b[\s\S]*$/i, '');
  }
  return '';
}

function htmlToText(block) {
  return block
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<(br|hr)\s*\/?\s*>/gi, '\n')
    .replace(/<\/(p|section|div|h1|h2|h3|h4|li|blockquote)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<img[^>]+alt=["']([^"']+)["'][^>]*>/gi, '\n$1\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\r/g, '')
    .split('\n')
    .map(x => decodeHtml(x).replace(/[ \t\u00a0]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}

function safeFilename(title) {
  return (title || 'wechat-article')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90) || 'wechat-article';
}

function isoWeek(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function toShanghaiIso(date) {
  const sh = new Date(date.getTime() + 8 * 3600 * 1000);
  const pad = n => String(n).padStart(2, '0');
  return `${sh.getUTCFullYear()}-${pad(sh.getUTCMonth() + 1)}-${pad(sh.getUTCDate())}T${pad(sh.getUTCHours())}:${pad(sh.getUTCMinutes())}:${pad(sh.getUTCSeconds())}+08:00`;
}

function addDigest(entry) {
  const dt = new Date(entry.timestamp.replace('+08:00', '+08:00'));
  const week = isoWeek(new Date(dt.getTime()));
  const dir = path.join(workspace, 'daily-digest', week);
  const file = path.join(dir, 'entries.jsonl');
  fs.mkdirSync(dir, { recursive: true });
  let entries = [];
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      if (!line.trim()) continue;
      try { entries.push(JSON.parse(line)); } catch {}
    }
  }
  if (entries.some(e => e.url === entry.url)) return { digestFile: file, added: false, total: entries.length };

  let maxId = 0;
  const root = path.join(workspace, 'daily-digest');
  if (fs.existsSync(root)) {
    for (const weekDir of fs.readdirSync(root)) {
      const p = path.join(root, weekDir, 'entries.jsonl');
      if (!fs.existsSync(p)) continue;
      for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
        try {
          const m = (JSON.parse(line).id || '').match(/entry-(\d+)/);
          if (m) maxId = Math.max(maxId, parseInt(m[1], 10));
        } catch {}
      }
    }
  }
  entry.id = entry.id || `entry-${String(maxId + 1).padStart(3, '0')}`;
  entries.push(entry);
  fs.writeFileSync(file, entries.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf8');
  return { digestFile: file, added: true, total: entries.length, id: entry.id };
}

(async () => {
  let lastErr = null;
  for (let i = 0; i < UA_LIST.length; i++) {
    try {
      const res = await fetchBuffer(url, UA_LIST[i]);
      const html = res.buffer.toString('utf8');
      const hash = crypto.createHash('sha1').update(url).digest('hex').slice(0, 16);
      const htmlOut = path.join(tmpDir, `wechat_${hash}.html`);
      fs.writeFileSync(htmlOut, res.buffer);

      const title = pick(html, [
        /var\s+msg_title\s*=\s*'([^']*)'/,
        /var\s+msg_title\s*=\s*"([^"]*)"/,
        /<meta\s+property=["']og:title["']\s+content=["']([^"']*)["']/i,
        /<title[^>]*>([\s\S]*?)<\/title>/i
      ]);
      const author = pick(html, [
        /var\s+nickname\s*=\s*"([^"]*)"/,
        /var\s+nickname\s*=\s*'([^']*)'/,
        /var\s+user_name\s*=\s*"([^"]*)"/
      ]);
      const block = extractContentBlock(html);
      const text = htmlToText(block);
      const ok = res.statusCode === 200 && title && text.length > 500;
      if (!ok) throw new Error(`bad_extract status=${res.statusCode} title=${Boolean(title)} chars=${text.length}`);

      const mdPath = path.join(outDir, `${safeFilename(title)}.md`);
      const md = `# ${title}\n\n- 原文链接：${url}\n- 来源：${author || '微信公众号'}\n- 抓取时间：${timestamp}\n- 抓取策略：direct-html/ua-${i + 1}\n\n---\n\n${text}\n`;
      fs.writeFileSync(mdPath, md, 'utf8');

      let digest = null;
      if (has('--digest')) {
        const summary = text.slice(0, 260).replace(/\n/g, ' ');
        digest = addDigest({
          timestamp,
          type: 'article',
          url,
          title,
          summary,
          tags: ['微信公众号', '待阅读'],
          source: author || '微信公众号',
          contentStatus: '已抓取全文，存D盘',
          localPath: mdPath.replace(/\//g, '\\')
        });
      }

      console.log(JSON.stringify({ ok: true, title, author, chars: text.length, mdPath, htmlOut, digest }, null, 2));
      return;
    } catch (e) {
      lastErr = e;
    }
  }
  console.error(JSON.stringify({ ok: false, error: lastErr && lastErr.message }, null, 2));
  process.exit(1);
})();
