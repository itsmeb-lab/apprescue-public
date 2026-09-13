/* Run: node --test tests/homepage-launch.test.cjs
 * No dependencies, network, credentials, or third-party API calls.
 * Hosted public routes are recorded, not claimed live.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const style = html.match(/<style>([\s\S]*?)<\/style>/)[1];
const ui = html.match(/<script id="homepage-ui">([\s\S]*?)<\/script>/)[1];

const HOSTED_PUBLICATION = Object.freeze({
  'https://apprescue.ai/release-evidence/': 'PENDING_HOSTED_PUBLICATION',
  'https://apprescue.ai/resources/': 'PENDING_HOSTED_PUBLICATION',
  'https://apprescue.ai/resources/app-cost-calculator/': 'PENDING_HOSTED_PUBLICATION',
  'https://apprescue.ai/resources/ai-app-running-costs/': 'PENDING_HOSTED_PUBLICATION',
  'https://apprescue.ai/resources/app-portability-checklist/': 'PENDING_HOSTED_PUBLICATION'
});

const BUNDLE_ROUTES = Object.freeze([
  'release-evidence/index.html',
  'resources/index.html',
  'resources/app-cost-calculator/index.html',
  'resources/ai-app-running-costs/index.html',
  'resources/app-portability-checklist/index.html',
  'favicon.svg',
  'og-image.svg'
]);

function hexToRgb(hex) {
  const n = hex.replace('#', '');
  return [n.slice(0, 2), n.slice(2, 4), n.slice(4, 6)].map((p) => parseInt(p, 16));
}

function channel(c) {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(fg, bg) {
  const a = luminance(fg);
  const b = luminance(bg);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

function cssVar(name) {
  const match = style.match(new RegExp(name.replace('--', '--') + ':\\s*(#[0-9A-Fa-f]{6})'));
  assert.ok(match, 'missing CSS color ' + name);
  return match[1];
}

function makeDom(fetchImpl) {
  const classLists = new Map();
  function classListFor(el) {
    if (!classLists.has(el)) {
      const set = new Set();
      classLists.set(el, {
        toggle(name, force) {
          if (force) set.add(name);
          else set.delete(name);
        },
        add(name) { set.add(name); },
        remove(name) { set.delete(name); },
        contains(name) { return set.has(name); }
      });
    }
    return classLists.get(el);
  }

  const nodes = {
    form: {
      hidden: false,
      addEventListener(type, fn) { this.handlers = this.handlers || {}; this.handlers[type] = fn; }
    },
    submit: { disabled: false },
    email: {
      value: 'founder@example.com',
      addEventListener(type, fn) { this.handlers = this.handlers || {}; this.handlers[type] = fn; },
      setAttribute(name, value) { this.attrs = this.attrs || {}; this.attrs[name] = value; },
      focus() { this.focused = true; }
    },
    emailError: { hidden: true },
    status: {
      textContent: '',
      setAttribute(name, value) { this.attrs = this.attrs || {}; this.attrs[name] = value; },
      removeAttribute(name) { if (this.attrs) delete this.attrs[name]; }
    },
    success: { hidden: true }
  };

  Object.defineProperty(nodes.email, 'classList', { get() { return classListFor(this); } });

  const byId = {
    'beta-signup-form': nodes.form,
    'submit-btn': nodes.submit,
    email: nodes.email,
    'email-error': nodes.emailError,
    'form-status': nodes.status,
    'form-success': nodes.success
  };

  const sandbox = {
    pendingFetch: null,
    document: {
      getElementById(id) { return byId[id] || null; }
    },
    fetch: fetchImpl,
    FormData: class {
      constructor() {}
    },
    URLSearchParams: class {
      constructor() {}
      toString() { return 'form-name=beta-signup&email=founder%40example.com'; }
    },
    AbortController: class {
      constructor() { this.signal = { aborted: false }; this.abort = () => { this.signal.aborted = true; }; }
    },
    setTimeout,
    clearTimeout
  };

  vm.createContext(sandbox);
  vm.runInContext(ui, sandbox);
  return { nodes, sandbox };
}

test('bundle routes exist locally and public host status is pending', () => {
  for (const rel of BUNDLE_ROUTES) {
    assert.equal(fs.existsSync(path.join(root, rel)), true, rel);
  }
  for (const [url, status] of Object.entries(HOSTED_PUBLICATION)) {
    assert.equal(status, 'PENDING_HOSTED_PUBLICATION', url);
  }
});

test('page uses one h1 and landmark structure', () => {
  assert.equal((html.match(/<h1[\s>]/g) || []).length, 1);
  assert.match(html, /<header class="site-header">/);
  assert.match(html, /<nav aria-label="Primary">/);
  assert.match(html, /<main id="main">/);
  assert.match(html, /<footer class="site-footer">/);
  assert.match(html, /class="skip"[^>]*href="#main"/);
});

test('hero uses the launch framing and allowed CTAs', () => {
  assert.match(html, /Know what to check before your next release\./);
  assert.match(html, /Free tools to organize your release evidence and app costs/);
  assert.match(html, /href="\/release-evidence\/"/);
  assert.match(html, /href="#beta"/);
  assert.match(html, /href="\/resources\/"/);
  assert.match(html, /href="\/resources\/app-cost-calculator\/"/);
});

test('at most six compact page sections', () => {
  const ids = [...html.matchAll(/<section id="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids, ['hero', 'tools', 'sample', 'pilot', 'how', 'beta']);
});

test('copy does not make unsupported present-tense promises', () => {
  const forbidden = [
    /we get you to production/i,
    /find(?:s|ing)? all hidden risks/i,
    /verif(?:y|ies|ying) behavior from structure/i,
    /instant source import/i,
    /autonomous repairs/i,
    /buy\.stripe\.com/,
    /checkout\.stripe\.com/,
    /paypal\.com/,
    /tests passed/,
    /limited early access/i,
    /opening soon/i
  ];
  for (const re of forbidden) assert.doesNotMatch(html, re);
  assert.match(html, /not a penetration test, security certification/);
  assert.doesNotMatch(html, /(?:is|offers?|provides?|issues?)\s+(?:a\s+)?production certification/i);
});

test('pilot price is proposed and bounded', () => {
  assert.match(html, /\$499/);
  assert.match(html, /proposed one-time pilot price/);
  assert.match(html, /agreed in writing before invoicing/);
  assert.match(html, /not a penetration test/);
  assert.match(html, /Roadmap, not a product card/);
  assert.match(html, /does not take orders/);
});

test('sample is illustrative and does not invent a score', () => {
  assert.match(html, /Illustrative only · self-reported structure/);
  assert.match(html, /Unknown \/ not run/);
  assert.match(html, /Next check/);
  assert.doesNotMatch(html, /risk score|readiness score|%\s*ready/i);
  assert.match(html, /Detecting a tests folder is not the same as tests passing/);
});

test('no third-party requests before form use', () => {
  assert.doesNotMatch(html, /fonts\.googleapis|fonts\.gstatic|googletagmanager|google-analytics|doubleclick|facebook\.net|hotjar|segment\.com/i);
  assert.doesNotMatch(html, /<script[^>]+src=/i);
  assert.doesNotMatch(html, /<link[^>]+rel="(?:stylesheet|preconnect|preload)"[^>]+href="https?:\/\//i);
  assert.match(html, /<link rel="canonical" href="https:\/\/apprescue\.ai\/" \/>/);
});

test('no-JS essentials are not hidden by fade-in or mobile nav rules', () => {
  assert.doesNotMatch(style, /\.fade-in\s*\{[^}]*opacity\s*:\s*0/);
  assert.doesNotMatch(style, /\.nav-cta[^}]*display\s*:\s*none/);
  assert.match(style, /prefers-reduced-motion/);
  assert.doesNotMatch(html, /fonts\.googleapis\.com/);
  assert.match(style, /system-ui/);
});

test('primary colors meet 4.5:1 on the page background', () => {
  const bg = cssVar('--bg');
  const text = cssVar('--text');
  const muted = cssVar('--muted');
  const accent = cssVar('--accent');
  assert.ok(contrast(text, bg) >= 4.5, 'text ' + contrast(text, bg));
  assert.ok(contrast(muted, bg) >= 4.5, 'muted ' + contrast(muted, bg));
  assert.ok(contrast(accent, bg) >= 4.5, 'accent ' + contrast(accent, bg));
});

test('referenced local assets resolve in this candidate', () => {
  assert.match(html, /href="\/favicon\.svg"/);
  assert.match(html, /og-image\.svg/);
  assert.equal(fs.existsSync(path.join(root, 'favicon.svg')), true);
  assert.equal(fs.existsSync(path.join(root, 'og-image.svg')), true);
  assert.match(html, /Raster preview is deferred|raster preview is deferred/i);
});

test('Netlify form contract is unchanged', () => {
  assert.match(html, /<form[^>]*name="beta-signup"/);
  assert.match(html, /method="POST"/);
  assert.match(html, /action="\/"/);
  assert.match(html, /data-netlify="true"/);
  assert.match(html, /netlify-honeypot="bot-field"/);
  assert.match(html, /name="form-name"[^>]*value="beta-signup"|value="beta-signup"[^>]*name="form-name"/);
  assert.match(html, /name="bot-field"/);
  assert.match(html, /name="email"/);
  assert.match(html, /name="built_with"/);
  assert.match(html, /name="biggest_issue"/);
  assert.doesNotMatch(html, /type="file"/);
  assert.doesNotMatch(html, /name="(password|secret|credentials|customer-source|source_code)"/i);
});

test('privacy copy is accurate and does not invent retention', () => {
  assert.match(html, /Inquiry fields go to AppRescue through Netlify Forms/);
  assert.match(html, /Do not send code, credentials/);
  assert.match(html, /does not state a retention or deletion schedule/);
  assert.doesNotMatch(html, /we delete your data|support@|@gmail\.com/);
});

test('form script requires HTTP success and recovers from failure', () => {
  assert.match(ui, /event\.preventDefault\(\)/);
  assert.match(ui, /if \(!response\.ok\)/);
  assert.match(ui, /if \(pending\) return/);
  assert.match(ui, /submitBtn\.disabled = false/);
  assert.match(ui, /AbortError/);
  assert.match(ui, /role="status"|form-status/);
  assert.doesNotMatch(ui, /form\.submit\s*\(/);
  assert.match(html, /role="status"/);
});

test('successful mock response reveals success only after ok', async () => {
  const { nodes } = makeDom(() => Promise.resolve({ ok: true, status: 200 }));
  const event = { preventDefault() { event.prevented = true; } };
  await nodes.form.handlers.submit(event);
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  assert.equal(event.prevented, true);
  assert.equal(nodes.form.hidden, true);
  assert.equal(nodes.success.hidden, false);
  assert.match(nodes.status.textContent, /successful response/);
});

test('4xx mock keeps values and does not claim receipt', async () => {
  const { nodes } = makeDom(() => Promise.resolve({ ok: false, status: 422 }));
  await nodes.form.handlers.submit({ preventDefault() {} });
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  assert.equal(nodes.form.hidden, false);
  assert.equal(nodes.success.hidden, true);
  assert.equal(nodes.submit.disabled, false);
  assert.equal(nodes.email.value, 'founder@example.com');
  assert.match(nodes.status.textContent, /could not be sent/);
});

test('rejected fetch does not show success', async () => {
  const { nodes } = makeDom(() => Promise.reject(new Error('network')));
  await nodes.form.handlers.submit({ preventDefault() {} });
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  assert.equal(nodes.success.hidden, true);
  assert.equal(nodes.submit.disabled, false);
});

test('pending submit is ignored until the first request settles', async () => {
  let resolveFetch;
  const { nodes } = makeDom(() => new Promise((resolve) => { resolveFetch = resolve; }));
  const first = nodes.form.handlers.submit({ preventDefault() {} });
  const second = nodes.form.handlers.submit({ preventDefault() {} });
  assert.equal(nodes.submit.disabled, true);
  resolveFetch({ ok: true, status: 200 });
  await first;
  await second;
  await new Promise((r) => setImmediate(r));
  assert.equal(nodes.success.hidden, false);
});

test('local form mocks are not Netlify receipt', () => {
  assert.match(ui, /do not prove Netlify stored the inquiry/);
});

test('no tracking or secret scripts', () => {
  assert.doesNotMatch(html, /gtag\(|fbq\(|analytics|pixel/i);
  assert.doesNotMatch(html, /sk_live|sk_test|STRIPE|NETLIFY_AUTH/);
});

test('homepage file URL is documented for local serving', () => {
  assert.equal(pathToFileURL(path.join(root, 'index.html')).href.startsWith('file:'), true);
});
