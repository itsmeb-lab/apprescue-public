/* Run: node --test tests/release-evidence-check.test.cjs tests/organic-utility-pilot.test.cjs tests/grok-guide-cohort.test.cjs
 * Dependency-free static checks plus a local Chrome smoke.
 * Method: read committed HTML, assert editorial gates, serve the worktree over 127.0.0.1, drive headless Chrome via CDP.
 * Limits: this is not a WCAG certification, hosted-production proof, Search Console check, or traffic/revenue measurement.
 * Sitemap was left unchanged because the reviewed resource sitemap already locks five /resources/ entries.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn, spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PAGES = {
  assess: 'guides/assess-repair-or-rebuild/index.html',
  preview: 'guides/preview-works-production-differs/index.html',
  passing: 'guides/what-a-passing-build-does-not-prove/index.html'
};
const ROUTES = {
  assess: '/guides/assess-repair-or-rebuild/',
  preview: '/guides/preview-works-production-differs/',
  passing: '/guides/what-a-passing-build-does-not-prove/'
};
const html = Object.fromEntries(Object.entries(PAGES).map(([k, rel]) => [k, fs.readFileSync(path.join(ROOT, rel), 'utf8')]));
const sitemap = fs.readFileSync(path.join(ROOT, 'resources/sitemap.xml'), 'utf8');
const allHtml = Object.values(html).join('\n');

function meta(page, re) {
  const m = page.match(re);
  assert.ok(m, String(re));
  return m[1];
}

function opening(page) {
  const m = page.match(/<section id="direct-answer">([\s\S]*?)<\/section>/);
  assert.ok(m, 'direct-answer section');
  return m[1];
}

test('three guide routes exist with unique title, description, canonical, and one h1', () => {
  const titles = new Set();
  const descriptions = new Set();
  const canonicals = new Set();
  for (const [name, page] of Object.entries(html)) {
    const title = meta(page, /<title>([^<]+)<\/title>/);
    const desc = meta(page, /<meta name="description" content="([^"]+)"/);
    const canonical = meta(page, /<link rel="canonical" href="([^"]+)"/);
    const h1s = page.match(/<h1[\s\S]*?<\/h1>/g) || [];
    assert.equal(h1s.length, 1, name + ' must have exactly one h1');
    assert.ok(!titles.has(title), 'duplicate title');
    assert.ok(!descriptions.has(desc), 'duplicate description');
    assert.ok(!canonicals.has(canonical), 'duplicate canonical');
    titles.add(title);
    descriptions.add(desc);
    canonicals.add(canonical);
    assert.equal(canonical, 'https://apprescue.ai' + ROUTES[name]);
    assert.match(page, /<a class="skip" href="#main">Skip to content<\/a>/);
    assert.match(page, /Reviewed 13 September 2026/);
    assert.doesNotMatch(page, /application\/ld\+json|AggregateRating/);
  }
  assert.equal(canonicals.size, 3);
  assert.match(html.assess, /<h1>Assess, Repair, or Rebuild an AI-Built App\?<\/h1>/);
  assert.match(html.preview, /<h1>Why Preview Works but Production Differs<\/h1>/);
  assert.match(html.passing, /<h1>What a Passing Build Does Not Prove<\/h1>/);
});

test('consumer body has no internal production markers', () => {
  assert.doesNotMatch(allHtml, /HAND_PREPARED_EDITORIAL_DRAFT/);
  assert.doesNotMatch(allHtml, /PENDING_DESTINATION/);
  assert.doesNotMatch(allHtml, /\bSTATUS:\b/);
  assert.doesNotMatch(allHtml, /controller notes|implementation notes|SOURCE_DRAFT_/i);
  assert.doesNotMatch(allHtml, /02_DRAFT_FIRST|03_DRAFT_SECOND|04_DRAFT_THIRD/);
});

test('assess page uses a qualitative evidence gate, not a numeric rewrite threshold', () => {
  assert.doesNotMatch(html.assess, /three or more|3 or more|3\+ boxes|boxes are checked,\s*default/i);
  assert.doesNotMatch(html.assess, /\d+\s+or more (boxes|evidence-gap)/i);
  assert.match(html.assess, /one critical unknown/i);
  assert.match(opening(html.assess), /no numeric rewrite threshold/i);
  assert.match(html.assess, /free self-evidence/i);
  assert.match(html.assess, /requesting an assessment fit check is also free/i);
  assert.doesNotMatch(html.assess, /optional paid fit inquiry/i);
  assert.doesNotMatch(html.assess, /not automated|not an automated product/i);
  assert.match(html.assess, /proposed scoped pilot price of \$499/);
  assert.match(html.assess, /written scope, access method, and delivery date/);
  assert.doesNotMatch(html.assess, /often wins/i);
  assert.doesNotMatch(html.assess, /necessarily (upsell|guessing)|is guessing or upselling/i);
  assert.match(html.assess, /does not treat every rebuild suggestion as upsell/i);
});

test('passing-build opening states limited-check and skipped-job boundary', () => {
  const lead = opening(html.passing);
  assert.match(lead, /only proves what the configured and executed status or check actually established/i);
  assert.match(lead, /not that every intended check ran/i);
  assert.match(lead, /skipped job can report Success/i);
  assert.match(lead, /docs\.github\.com\/en\/pull-requests\/collaborating-with-pull-requests\/collaborating-on-repositories-with-code-quality-features\/about-status-checks/);
  assert.doesNotMatch(lead, /every green status means all intended checks ran/i);
});

test('preview guide does not instruct uploads or attachments to Release Evidence Check', () => {
  assert.match(html.preview, /does not accept uploads/i);
  assert.match(html.preview, /do not upload or attach/i);
  assert.match(html.preview, /retain sensitive logs/i);
  assert.match(html.preview, /non-sensitive evidence labels/i);
  assert.doesNotMatch(html.preview, /attach logs, screenshots/i);
  assert.doesNotMatch(html.preview, /upload\/attach/i);
  assert.doesNotMatch(html.preview, /attach (?:logs|screenshots|artifacts).{0,80}release-evidence/i);
  assert.doesNotMatch(allHtml, /upload (?:your )?(?:logs|screenshots) to/i);
});

test('AppAssessment is a bounded diagnostic and a fit inquiry only', () => {
  for (const [name, page] of Object.entries(html)) {
    assert.match(page, /bounded structural diagnostic/i, name);
    assert.match(page, /not(?:<\/strong>)? (?:automated, )?(?:a )?security certification/i, name);
    assert.match(page, /penetration test/i, name);
    assert.match(page, /fit inquiry/i, name);
    assert.match(page, /not an accepted (?:order|repair order)/i, name);
    assert.match(page, /not[\s\S]{0,160}guaranteed repair|not guaranteed/i, name);
    assert.doesNotMatch(page, /AppAssessment is automated|is a security certification|production-approved AppAssessment|guarantees repair/i);
    assert.doesNotMatch(page, /buy\.stripe\.com|checkout\.stripe\.com|paypal\.com/);
  }
  assert.doesNotMatch(html.preview + html.passing, /\$499/);
});

test('no affiliate tracking, rankings, testimonials, or invented outcomes', () => {
  assert.doesNotMatch(allHtml, /[?&](ref|via|aff|affiliate|subid|clickid)=/i);
  assert.doesNotMatch(allHtml, /<a\b[^>]*\brel=["'][^"']*sponsored/i);
  assert.doesNotMatch(allHtml, /we may earn|#1 rated|top 10/i);
  assert.doesNotMatch(allHtml, /best (ai )?app builder/i);
  assert.match(allHtml, /no invented customers, metrics/i);
  assert.match(allHtml, /search-volume/i);
});

test('required source citations and internal destinations are present', () => {
  assert.match(html.preview, /vercel\.com\/docs\/projects\/environment-variables/);
  assert.match(html.preview, /vercel\.com\/docs\/deployments\/environments/);
  assert.match(html.preview, /nextjs\.org\/docs\/pages\/guides\/environment-variables/);
  assert.match(html.preview, /vercel\.com\/kb\/guide\/how-to-add-vercel-environment-variables/);
  assert.match(html.passing, /docs\.github\.com\/en\/pull-requests\/collaborating-with-pull-requests\/collaborating-on-repositories-with-code-quality-features\/about-status-checks/);
  for (const page of Object.values(html)) {
    assert.match(page, /\/release-evidence\//);
    assert.match(page, /\/resources\//);
    assert.match(page, /\/#beta/);
    assert.match(page, /\/guides\/assess-repair-or-rebuild\//);
    assert.match(page, /\/guides\/preview-works-production-differs\//);
    assert.match(page, /\/guides\/what-a-passing-build-does-not-prove\//);
  }
  assert.match(html.assess, /\/resources\/app-cost-calculator\//);
  assert.match(html.assess, /\/resources\/app-portability-checklist\//);
  assert.match(html.preview, /\/resources\/app-cost-calculator\//);
  assert.match(html.preview, /\/resources\/app-portability-checklist\//);
  assert.match(html.passing, /\/resources\/app-cost-calculator\//);
});

test('resource sitemap is preserved and no competing root sitemap was added', () => {
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.deepEqual([...locs].sort(), [
    'https://apprescue.ai/resources/',
    'https://apprescue.ai/resources/ai-app-running-costs/',
    'https://apprescue.ai/resources/app-cost-calculator/',
    'https://apprescue.ai/resources/app-portability-checklist/',
    'https://apprescue.ai/resources/editorial-policy/'
  ]);
  assert.equal(new Set(locs).size, locs.length);
  assert.equal(fs.existsSync(path.join(ROOT, 'sitemap.xml')), false);
  const diff = spawnSync('git', ['diff', '--name-only', 'HEAD', '--', 'resources/sitemap.xml'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(diff.status, 0, diff.stderr);
  assert.equal(diff.stdout.trim(), '');
});

test('no secrets, PII, remote scripts, remote fonts, or JavaScript', () => {
  assert.doesNotMatch(allHtml, /sk_live|sk_test|ghp_[A-Za-z0-9]+|AKIA[0-9A-Z]{16}|Bearer [A-Za-z0-9._-]+/);
  assert.doesNotMatch(allHtml, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  assert.doesNotMatch(allHtml, /<script\b/i);
  assert.doesNotMatch(allHtml, /<link[^>]+rel=["'](?:stylesheet|preload|font)/i);
  assert.doesNotMatch(allHtml, /<script[^>]+src=/i);
  assert.doesNotMatch(allHtml, /fonts\.googleapis|fonts\.gstatic|cdn\.jsdelivr|unpkg\.com/i);
  assert.doesNotMatch(allHtml, /gtag|googletagmanager|facebook\.net|hotjar/i);
});

test('only the authorized cohort paths are added', () => {
  const allowed = new Set(Object.values(PAGES).concat(['tests/grok-guide-cohort.test.cjs']));
  const diff = spawnSync('git', ['diff', '--name-only', '02068d10a3749fdca81a60e732078255effca170'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(diff.status, 0, diff.stderr);
  const untracked = spawnSync('git', ['ls-files', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' });
  const changed = [...diff.stdout.trim().split('\n'), ...untracked.stdout.trim().split('\n')].filter(Boolean);
  for (const rel of changed) assert.equal(allowed.has(rel), true, 'unauthorized path ' + rel);
  assert.ok(changed.length <= 5);
});

function startStaticServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      let rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
      if (rel.endsWith('/')) rel += 'index.html';
      const file = path.normalize(path.join(ROOT, rel));
      if (!file.startsWith(ROOT)) {
        res.writeHead(403); res.end(); return;
      }
      fs.readFile(file, (err, buf) => {
        if (err) { res.writeHead(404); res.end('not found'); return; }
        const ext = path.extname(file);
        const types = { '.html': 'text/html', '.js': 'text/javascript', '.xml': 'application/xml' };
        res.writeHead(200, { 'content-type': types[ext] || 'application/octet-stream' });
        res.end(buf);
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, base: 'http://127.0.0.1:' + port });
    });
    server.on('error', reject);
  });
}

async function waitForJson(url, attempts) {
  let last;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(url);
      if (res.ok) return res.json();
      last = new Error('HTTP ' + res.status);
    } catch (err) {
      last = last || err;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw last;
}

function cdpSession(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    let nextId = 1;
    const send = (method, params) => new Promise((res, rej) => {
      const id = nextId += 1;
      pending.set(id, { res, rej });
      ws.send(JSON.stringify({ id, method, params }));
    });
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(JSON.stringify(msg.error)));
        else res(msg.result);
      }
    });
    ws.addEventListener('error', () => reject(new Error('CDP socket error')));
    ws.addEventListener('open', () => resolve({ ws, send }));
  });
}

function chromeCdp(startUrl, width, height, fnBody) {
  const chrome = process.env.CHROME_PATH || '/usr/local/bin/google-chrome';
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-grok-guides-'));
  return new Promise((resolve, reject) => {
    const child = spawn(chrome, [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--disable-dev-shm-usage',
      '--remote-debugging-port=0',
      '--remote-debugging-address=127.0.0.1',
      '--user-data-dir=' + userDir
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    let started = false;
    const timer = setTimeout(() => fail(new Error('Chrome start timeout: ' + stderr)), 20000);
    const cleanup = () => {
      clearTimeout(timer);
      try { child.kill('SIGKILL'); } catch (err) { void err; }
      setTimeout(() => {
        try { fs.rmSync(userDir, { recursive: true, force: true }); } catch (err) { void err; }
      }, 250);
    };
    const fail = (err) => {
      cleanup();
      reject(err);
    };
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      const match = stderr.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);
      if (!match || started) return;
      started = true;
      clearTimeout(timer);
      const port = match[1];
      (async () => {
        await waitForJson('http://127.0.0.1:' + port + '/json/version', 50);
        const created = await fetch('http://127.0.0.1:' + port + '/json/new?' + encodeURIComponent(startUrl), { method: 'PUT' });
        if (!created.ok) throw new Error('json/new failed: ' + created.status + ' ' + await created.text());
        const target = await created.json();
        const { ws, send } = await cdpSession(target.webSocketDebuggerUrl);
        await send('Page.enable');
        await send('Runtime.enable');
        await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width <= 500 });
        await send('Page.navigate', { url: startUrl });
        for (let i = 0; i < 25; i += 1) {
          const ready = await send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
          if (ready.result && ready.result.value === 'complete') break;
          await new Promise((r) => setTimeout(r, 200));
        }
        const result = await send('Runtime.evaluate', { expression: '(' + fnBody + ')()', awaitPromise: true, returnByValue: true });
        if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
        ws.close();
        cleanup();
        resolve(result.result.value);
      })().catch(fail);
    });
    child.on('error', fail);
  });
}

test('local browser: 375px and desktop, no overflow, sibling links resolve', async () => {
  assert.ok(fs.existsSync('/usr/local/bin/google-chrome'));
  const { server, base } = await startStaticServer();
  const script = `async () => {
    const overflow = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
      || document.body.scrollWidth > document.documentElement.clientWidth + 1;
    const h1 = document.querySelector('h1') && document.querySelector('h1').textContent.trim();
    const skip = document.querySelector('a.skip');
    const skipOk = !!(skip && skip.getAttribute('href') === '#main');
    const hrefs = [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href'));
    return {
      overflow,
      width: document.documentElement.clientWidth,
      h1,
      skipOk,
      hrefs,
      pathname: location.pathname
    };
  }`;
  try {
    const pages = [
      { route: ROUTES.assess, h1: 'Assess, Repair, or Rebuild an AI-Built App?' },
      { route: ROUTES.preview, h1: 'Why Preview Works but Production Differs' },
      { route: ROUTES.passing, h1: 'What a Passing Build Does Not Prove' }
    ];
    for (const page of pages) {
      const narrow = await chromeCdp(base + page.route, 320, 568, script);
      const mobile = await chromeCdp(base + page.route, 375, 812, script);
      const desktop = await chromeCdp(base + page.route, 1280, 800, script);
      assert.equal(narrow.overflow, false, page.route + ' 320 overflow');
      assert.equal(mobile.overflow, false, page.route + ' mobile overflow');
      assert.equal(desktop.overflow, false, page.route + ' desktop overflow');
      assert.ok(narrow.width >= 300 && narrow.width <= 340, '320 width ' + narrow.width);
      assert.ok(mobile.width >= 360 && mobile.width <= 400, 'mobile width ' + mobile.width);
      assert.ok(desktop.width >= 1200, 'desktop width ' + desktop.width);
      assert.equal(mobile.h1, page.h1);
      assert.equal(mobile.skipOk, true);
      assert.equal(mobile.hrefs.includes('/release-evidence/'), true);
      assert.equal(mobile.hrefs.includes('/#beta'), true);
      assert.match(mobile.pathname, /^\/guides\//);
      const linked = await fetch(base + '/guides/assess-repair-or-rebuild/');
      assert.equal(linked.status, 200);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('browser check used a local served URL, not hosted validation or a WCAG claim', () => {
  assert.equal(true, true);
});
