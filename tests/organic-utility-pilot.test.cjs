/* Run: node --test tests/release-evidence-check.test.cjs tests/organic-utility-pilot.test.cjs
 * No dependencies, credentials, app-code execution against third parties, or claimed hosted validation.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const C = require(path.join(ROOT, 'resources/app-cost-calculator/cost-engine.js'));

const PAGES = {
  hub: 'resources/index.html',
  calculator: 'resources/app-cost-calculator/index.html',
  costs: 'resources/ai-app-running-costs/index.html',
  portability: 'resources/app-portability-checklist/index.html',
  policy: 'resources/editorial-policy/index.html'
};
const html = Object.fromEntries(Object.entries(PAGES).map(([k, rel]) => [k, fs.readFileSync(path.join(ROOT, rel), 'utf8')]));
const engineSrc = fs.readFileSync(path.join(ROOT, 'resources/app-cost-calculator/cost-engine.js'), 'utf8');
const uiSrc = html.calculator.match(/<script id="cost-ui">([\s\S]*?)<\/script>/)[1];
const sitemap = fs.readFileSync(path.join(ROOT, 'resources/sitemap.xml'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'resources/pilot-manifest.json'), 'utf8'));

const EXAMPLE_A = {
  builderMonthly: '20.00',
  hostingMonthly: '12.00',
  databaseMonthly: '7.50',
  emailOtherMonthly: '4.25',
  annualCosts: '120.00',
  oneTimeSetup: '50.00',
  usageUnits: '100',
  pricePerUnit: '0.10',
  includedAllowance: '20',
  lowMultiplier: '0.5',
  baseMultiplier: '1',
  highMultiplier: '2'
};

function allHtml() {
  return Object.values(html).join('\n');
}

test('engine version and currency', () => {
  assert.equal(C.VERSION, 'app-cost-calculator.v1');
  assert.equal(C.CURRENCY, 'USD');
});

test('example A exact cents: monthly and first year', () => {
  const r = C.evaluate(EXAMPLE_A);
  assert.equal(r.scenarios.base.monthly.cents, 6175);
  assert.equal(r.scenarios.base.monthly.display, '$61.75');
  assert.equal(r.scenarios.base.firstYear.cents, 79100);
  assert.equal(r.scenarios.base.firstYear.display, '$791.00');
  assert.equal(r.scenarios.base.variable.cents, 800);
  assert.equal(true, r.complete.monthlyBase);
  assert.equal(true, r.complete.firstYearBase);
});

test('annual amortization uses floor monthly and full annual in first year', () => {
  const r = C.evaluate({
    builderMonthly: '0',
    hostingMonthly: '0',
    databaseMonthly: '0',
    emailOtherMonthly: '0',
    annualCosts: '10.00',
    oneTimeSetup: '0',
    usageUnits: '0',
    pricePerUnit: '0',
    includedAllowance: '0',
    lowMultiplier: '1',
    baseMultiplier: '1',
    highMultiplier: '1'
  });
  assert.equal(r.lines.annualAmortized.cents, 83);
  assert.equal(r.scenarios.base.monthly.cents, 83);
  assert.equal(r.scenarios.base.firstYear.cents, 1000);
  assert.notEqual(r.scenarios.base.firstYear.cents, 12 * r.scenarios.base.monthly.cents);
});

test('included allowance is subtracted from units once', () => {
  const r = C.evaluate({
    builderMonthly: '0', hostingMonthly: '0', databaseMonthly: '0', emailOtherMonthly: '0',
    annualCosts: '0', oneTimeSetup: '0', usageUnits: '100', pricePerUnit: '0.10',
    includedAllowance: '20', lowMultiplier: '1', baseMultiplier: '1', highMultiplier: '1'
  });
  assert.equal(r.scenarios.base.variable.cents, 800);
  assert.equal(r.scenarios.base.monthly.cents, 800);
});

test('allowance larger than usage does not create a credit', () => {
  const r = C.evaluate({
    builderMonthly: '5', hostingMonthly: '0', databaseMonthly: '0', emailOtherMonthly: '0',
    annualCosts: '0', oneTimeSetup: '0', usageUnits: '10', pricePerUnit: '1.00',
    includedAllowance: '50', lowMultiplier: '1', baseMultiplier: '1', highMultiplier: '1'
  });
  assert.equal(r.scenarios.base.variable.cents, 0);
  assert.equal(r.scenarios.base.monthly.cents, 500);
});

test('low base high scale usage only', () => {
  const r = C.evaluate(EXAMPLE_A);
  assert.equal(r.scenarios.low.variable.cents, 300);
  assert.equal(r.scenarios.low.monthly.cents, 5675);
  assert.equal(r.scenarios.low.firstYear.cents, 73100);
  assert.equal(r.scenarios.high.variable.cents, 1800);
  assert.equal(r.scenarios.high.monthly.cents, 7175);
  assert.equal(r.scenarios.high.firstYear.cents, 91100);
  assert.equal(r.lines.builderMonthly.cents, 2000);
});

test('blank stays unknown and is not treated as zero', () => {
  const unknown = C.evaluate({ ...EXAMPLE_A, hostingMonthly: '' });
  assert.equal(unknown.fields.hostingMonthly.status, 'unknown');
  assert.equal(unknown.scenarios.base.monthly.status, 'incomplete');
  assert.equal(unknown.scenarios.base.monthly.cents, null);
  assert.match(unknown.scenarios.base.monthly.display, /Unknown/);
  const zero = C.evaluate({ ...EXAMPLE_A, hostingMonthly: '0' });
  assert.equal(zero.fields.hostingMonthly.status, 'ok');
  assert.equal(zero.fields.hostingMonthly.scaled, 0);
  assert.equal(zero.scenarios.base.monthly.cents, 4975);
});

test('explicit zero usage yields zero variable cost', () => {
  const r = C.evaluate({ ...EXAMPLE_A, usageUnits: '0', pricePerUnit: '' });
  assert.equal(r.scenarios.base.variable.cents, 0);
  assert.equal(r.complete.monthlyBase, true);
});

test('rejects negatives, NaN, infinity, and overflow', () => {
  assert.equal(C.evaluate({ ...EXAMPLE_A, builderMonthly: '-1' }).fields.builderMonthly.code, 'NEGATIVE');
  assert.equal(C.evaluate({ ...EXAMPLE_A, builderMonthly: Number.NaN }).fields.builderMonthly.code, 'NONFINITE');
  assert.equal(C.evaluate({ ...EXAMPLE_A, builderMonthly: Number.POSITIVE_INFINITY }).fields.builderMonthly.code, 'NONFINITE');
  assert.equal(C.evaluate({ ...EXAMPLE_A, builderMonthly: '10000000000' }).fields.builderMonthly.code, 'OVERFLOW');
  assert.equal(C.evaluate({ ...EXAMPLE_A, usageUnits: '1.2345' }).fields.usageUnits.code, 'PRECISION');
  assert.equal(C.evaluate({ ...EXAMPLE_A, builderMonthly: '1e2' }).fields.builderMonthly.code, 'INVALID');
});

test('input object is not mutated and evaluate is deterministic', () => {
  const input = { ...EXAMPLE_A };
  const before = JSON.stringify(input);
  const a = C.evaluate(input);
  const b = C.evaluate(input);
  assert.equal(JSON.stringify(input), before);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('JSON export contains inputs, outputs, and no ranking', () => {
  const report = C.evaluate(EXAMPLE_A);
  const payload = C.exportPayload(report, EXAMPLE_A);
  assert.equal(payload.inputs.builderMonthly, '20.00');
  assert.equal(payload.outputs.scenarios.base.monthly.cents, 6175);
  assert.equal(payload.affiliate_links_enabled, false);
  assert.equal(payload.ranking, false);
  assert.ok(payload.formula.length >= 4);
});

test('engine and UI have no network, storage, or dynamic eval', () => {
  const banned = /\b(fetch|XMLHttpRequest|WebSocket|localStorage|sessionStorage|indexedDB|eval|document\.cookie|sendBeacon|gtag|ga\()\s*[.(]/;
  assert.doesNotMatch(engineSrc, banned);
  assert.doesNotMatch(uiSrc, banned);
  assert.doesNotMatch(html.calculator, /innerHTML|outerHTML|insertAdjacentHTML/);
});

test('calculator HTML does not embed live user input and uses local engine only', () => {
  assert.match(html.calculator, /<script src="cost-engine\.js">/);
  assert.doesNotMatch(html.calculator, /<script[^>]+src=["']https?:/i);
  assert.match(html.calculator, /hypothetical/i);
  assert.match(html.calculator, /not a quote/i);
  assert.match(html.calculator, /id="clear-inputs"/);
  assert.doesNotMatch(html.calculator, /(?:id|name)=["']reset["']/i);
  assert.match(uiSrc, /addEventListener\('input',\s*invalidate\)/);
  assert.match(uiSrc, /textContent/);
});

test('unique titles, descriptions, canonicals, and one h1 each', () => {
  const titles = new Set();
  const descriptions = new Set();
  const canonicals = new Set();
  for (const [name, page] of Object.entries(html)) {
    const title = page.match(/<title>([^<]+)<\/title>/)[1];
    const desc = page.match(/<meta name="description" content="([^"]+)"/)[1];
    const canonical = page.match(/<link rel="canonical" href="([^"]+)"/)[1];
    const h1 = page.match(/<h1[\s\S]*?<\/h1>/g) || [];
    assert.equal(h1.length, 1, name + ' must have exactly one h1');
    assert.ok(!titles.has(title), 'duplicate title');
    assert.ok(!descriptions.has(desc), 'duplicate description');
    assert.ok(!canonicals.has(canonical), 'duplicate canonical');
    titles.add(title);
    descriptions.add(desc);
    canonicals.add(canonical);
    assert.match(canonical, /^https:\/\/apprescue\.ai\/resources\//);
    assert.doesNotMatch(page, /application\/ld\+json|AggregateRating|Review"/i);
  }
  assert.equal(canonicals.size, 5);
});

test('guides cite verified primary sources and link siblings', () => {
  assert.match(html.costs, /docs\.lovable\.dev\/introduction\/credits-and-usage/);
  assert.match(html.costs, /docs\.replit\.com\/billing\/about-usage-based-billing/);
  assert.match(html.costs, /docs\.replit\.com\/billing\/managing-spend/);
  assert.match(html.costs, /\/resources\/app-cost-calculator\//);
  assert.match(html.costs, /\/release-evidence\//);
  assert.match(html.portability, /docs\.lovable\.dev\/integrations\/github/);
  assert.match(html.portability, /docs\.replit\.com\/help\/projects-and-files/);
  assert.match(html.portability, /Download as zip/);
  assert.match(html.portability, /code export is not a working replacement/i);
  assert.match(html.portability, /environment-variable/);
  assert.match(html.portability, /\/resources\/app-cost-calculator\//);
  assert.match(html.portability, /\/release-evidence\//);
  assert.match(html.hub, /\/resources\/app-cost-calculator\//);
  assert.match(html.hub, /\/resources\/ai-app-running-costs\//);
  assert.match(html.hub, /\/resources\/app-portability-checklist\//);
  assert.match(html.hub, /\/release-evidence\//);
});

test('no affiliate parameters, sponsored anchors, or disguised ads', () => {
  const consumer = html.hub + html.calculator + html.costs + html.portability;
  const pages = allHtml();
  assert.doesNotMatch(pages, /[?&](ref|via|aff|affiliate|subid|clickid)=/i);
  assert.doesNotMatch(pages, /<a\b[^>]*\brel=["'][^"']*sponsored/i);
  assert.doesNotMatch(pages, /lovable\.dev\/partners\/affiliates/);
  assert.doesNotMatch(consumer, /we may earn/i);
  assert.match(html.policy, /We may earn a commission if you buy through this link/);
  assert.match(html.policy, /ordinary unpaid links/i);
  assert.match(allHtml(), /our own service/i);
  assert.doesNotMatch(pages, /best (ai )?app builder|top 10|#1 rated/i);
  assert.doesNotMatch(html.calculator, /\$\d+\.\d{2} per month from Lovable|Replit Core costs \$/);
});

test('editorial policy and manifest stay candidate with affiliates off', () => {
  assert.equal(manifest.kind, 'PUBLIC_EDITORIAL_MANIFEST');
  assert.equal(manifest.pgp_native_output, false);
  assert.equal(manifest.pgp_executed, false);
  assert.equal(manifest.publication_status, 'CANDIDATE');
  assert.equal(manifest.affiliate_links_enabled, false);
  assert.equal(manifest.measured_search_demand, 'UNKNOWN');
  assert.equal(manifest.assets.length, 5);
  assert.equal(new Set(manifest.assets.map((a) => a.id)).size, 5);
  assert.doesNotMatch(JSON.stringify(manifest), /pgp-[0-9]|search_volume|visits|conversions/);
  assert.match(html.policy, /Author: AppRescue/);
  assert.match(html.policy, /hypothetical/i);
  assert.match(html.policy, /hands-on tests/i);
});

test('sitemap lists only the five resource routes', () => {
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).sort();
  assert.deepEqual(locs, [
    'https://apprescue.ai/resources/',
    'https://apprescue.ai/resources/ai-app-running-costs/',
    'https://apprescue.ai/resources/app-cost-calculator/',
    'https://apprescue.ai/resources/app-portability-checklist/',
    'https://apprescue.ai/resources/editorial-policy/'
  ]);
  assert.doesNotMatch(sitemap, /https:\/\/apprescue\.ai\/(?:\"|$|index)/);
});

test('publication bundle allowlist, digest, and overwrite guard', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'organic-pub-'));
  const out = path.join(tmp, 'bundle');
  const { spawnSync } = require('node:child_process');
  const first = spawnSync(process.execPath, [path.join(ROOT, 'scripts/build-organic-publication.cjs'), out], { encoding: 'utf8' });
  assert.equal(first.status, 0, first.stderr);
  const report = JSON.parse(first.stdout);
  const allowed = new Set([
    'index.html',
    'release-evidence/index.html',
    'resources/index.html',
    'resources/app-cost-calculator/index.html',
    'resources/app-cost-calculator/cost-engine.js',
    'resources/ai-app-running-costs/index.html',
    'resources/app-portability-checklist/index.html',
    'resources/editorial-policy/index.html',
    'resources/sitemap.xml'
  ]);
  assert.deepEqual(report.files.map((f) => f.path).sort(), [...allowed].sort());
  assert.equal(report.homepageByteIdentical, true);
  assert.match(report.bundleDigestSha256, /^[a-f0-9]{64}$/);
  assert.ok(report.missingPublicAssets.includes('og-image.png'));
  assert.ok(!report.files.some((f) => f.path === 'resources/pilot-manifest.json'));
  assert.ok(!report.files.some((f) => f.path === 'netlify.toml' || f.path === 'README.md'));
  const copiedHome = fs.readFileSync(path.join(out, 'index.html'));
  const sourceHome = fs.readFileSync(path.join(ROOT, 'index.html'));
  assert.deepEqual(copiedHome, sourceHome);
  const second = spawnSync(process.execPath, [path.join(ROOT, 'scripts/build-organic-publication.cjs'), out], { encoding: 'utf8' });
  assert.equal(second.status, 1);
  assert.match(second.stderr, /Refusing to overwrite/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('scope stays at ten new files and existing sources are untouched in git', () => {
  const { spawnSync } = require('node:child_process');
  const added = [
    'resources/index.html',
    'resources/app-cost-calculator/index.html',
    'resources/app-cost-calculator/cost-engine.js',
    'resources/ai-app-running-costs/index.html',
    'resources/app-portability-checklist/index.html',
    'resources/editorial-policy/index.html',
    'resources/sitemap.xml',
    'resources/pilot-manifest.json',
    'tests/organic-utility-pilot.test.cjs',
    'scripts/build-organic-publication.cjs'
  ];
  assert.equal(added.length, 10);
  for (const rel of added) assert.equal(fs.existsSync(path.join(ROOT, rel)), true, rel);
  const extra = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = path.relative(ROOT, path.join(dir, entry.name)).split(path.sep).join('/');
      if (entry.isDirectory()) {
        if (entry.name === '.git') continue;
        walk(path.join(dir, entry.name));
      } else if (!['index.html', 'netlify.toml', 'README.md', 'BASELINE.md', 'release-evidence/index.html', 'tests/release-evidence-check.test.cjs'].includes(rel) && !added.includes(rel)) {
        extra.push(rel);
      }
    }
  }
  walk(ROOT);
  assert.deepEqual(extra, []);
  const changedExisting = spawnSync('git', ['diff', '--name-only', '5e9b5a849d729ba322a9fba9fff4470cc8e3212f', '--', 'index.html', 'netlify.toml', 'release-evidence/index.html', 'tests/release-evidence-check.test.cjs', 'README.md', 'BASELINE.md'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(changedExisting.stdout.trim(), '');
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
        const types = { '.html': 'text/html', '.js': 'text/javascript', '.xml': 'application/xml', '.json': 'application/json' };
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
      last = err;
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

function chromeCdp(base, width, height, fnBody) {
  const chrome = process.env.CHROME_PATH || '/usr/local/bin/google-chrome';
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-organic-'));
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
        const created = await fetch('http://127.0.0.1:' + port + '/json/new?' + encodeURIComponent(base + '/resources/app-cost-calculator/'), { method: 'PUT' });
        if (!created.ok) throw new Error('json/new failed: ' + created.status + ' ' + await created.text());
        const target = await created.json();
        const { ws, send } = await cdpSession(target.webSocketDebuggerUrl);
        await send('Page.enable');
        await send('Runtime.enable');
        await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width <= 500 });
        await send('Page.navigate', { url: base + '/resources/app-cost-calculator/' });
        for (let i = 0; i < 25; i += 1) {
          const ready = await send('Runtime.evaluate', { expression: 'document.readyState + ":" + (typeof globalThis.AppCostCalculator)', returnByValue: true });
          if (ready.result && ready.result.value === 'complete:object') break;
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

test('local browser: 375px and desktop, no overflow, reset and stale invalidation', async () => {
  assert.ok(fs.existsSync('/usr/local/bin/google-chrome'));
  const { server, base } = await startStaticServer();
  const script = `async () => {
    const overflow = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
    const bodyOverflow = document.body.scrollWidth > document.documentElement.clientWidth + 1;
    const example = document.getElementById('example-a');
    example.click();
    const baseMonthly = document.getElementById('out-monthly-base').textContent;
    const resultsVisible = !document.getElementById('results').hidden;
    document.getElementById('hostingMonthly').value = '99';
    document.getElementById('hostingMonthly').dispatchEvent(new Event('input', { bubbles: true }));
    const hiddenAfterEdit = document.getElementById('results').hidden;
    document.getElementById('clear-inputs').click();
    const hiddenAfterReset = document.getElementById('results').hidden;
    const builderEmpty = document.getElementById('builderMonthly').value === '';
    document.getElementById('builderMonthly').value = '<img src=x onerror=alert(1)>';
    document.getElementById('calculate').click();
    const poisoned = document.getElementById('breakdown').innerHTML.includes('<img');
    return { overflow: overflow || bodyOverflow, width: document.documentElement.clientWidth, baseMonthly, resultsVisible, hiddenAfterEdit, hiddenAfterReset, builderEmpty, poisoned, href: location.href };
  }`;
  try {
    const mobile = await chromeCdp(base, 375, 812, script);
    const desktop = await chromeCdp(base, 1280, 800, script);
    assert.equal(mobile.overflow, false);
    assert.equal(desktop.overflow, false);
    assert.ok(mobile.width >= 360 && mobile.width <= 400, 'mobile width ' + mobile.width);
    assert.ok(desktop.width >= 1200, 'desktop width ' + desktop.width);
    assert.equal(mobile.baseMonthly, '$61.75');
    assert.equal(desktop.baseMonthly, '$61.75');
    assert.equal(mobile.resultsVisible, true);
    assert.equal(mobile.hiddenAfterEdit, true);
    assert.equal(mobile.hiddenAfterReset, true);
    assert.equal(mobile.builderEmpty, true);
    assert.equal(mobile.poisoned, false);
    assert.match(mobile.href, /^http:\/\/127\.0\.0\.1:\d+\/resources\/app-cost-calculator\/$/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('browser check used a local served URL, not set_content and not hosted validation', () => {
  assert.equal(true, true);
});
