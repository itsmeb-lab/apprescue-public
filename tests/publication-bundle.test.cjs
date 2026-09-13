/* Independent publication-bundle coverage for scripts/build-organic-publication.cjs.
 * Uses synthetic fixtures only. Does not modify homepage, resources, or other protected paths.
 * Run: node --test tests/publication-bundle.test.cjs
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const REPO = path.join(__dirname, '..');
const REQUIRED_COPIES = [
  'scripts/build-organic-publication.cjs',
  'release-evidence/index.html',
  'resources/index.html',
  'resources/app-cost-calculator/index.html',
  'resources/app-cost-calculator/cost-engine.js',
  'resources/ai-app-running-costs/index.html',
  'resources/app-portability-checklist/index.html',
  'resources/editorial-policy/index.html',
  'resources/sitemap.xml'
];
const REQUIRED_ROUTES = [
  'index.html',
  'release-evidence/index.html',
  'resources/index.html',
  'resources/app-cost-calculator/index.html',
  'resources/app-cost-calculator/cost-engine.js',
  'resources/ai-app-running-costs/index.html',
  'resources/app-portability-checklist/index.html',
  'resources/editorial-policy/index.html',
  'resources/sitemap.xml'
];
const FORBIDDEN_PUBLIC = [
  'README.md',
  'BASELINE.md',
  'netlify.toml',
  'resources/pilot-manifest.json',
  'CHANGELOG.md',
  'tests/secret.test.cjs',
  'scripts/not-public.cjs'
];

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function seedFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pub-src-'));
  for (const rel of REQUIRED_COPIES) {
    fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
    fs.copyFileSync(path.join(REPO, rel), path.join(root, rel));
  }
  writeMinimalHomepage(root, '');
  return root;
}

function writeMinimalHomepage(root, extraHead) {
  const html = '<!DOCTYPE html><html><head><title>fixture</title>' + extraHead + '</head><body>fixture</body></html>\n';
  fs.writeFileSync(path.join(root, 'index.html'), html);
  return html;
}

function writeFile(root, rel, contents) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, contents);
}

function runBuild(root, out) {
  return spawnSync(process.execPath, [path.join(root, 'scripts/build-organic-publication.cjs'), out], {
    encoding: 'utf8'
  });
}

function assertFailure(result, out) {
  assert.notEqual(result.status, 0, result.stdout + '\n' + result.stderr);
  assert.equal(fs.existsSync(out), false, 'validation failure must not create an out-dir');
  assert.doesNotMatch(result.stdout, /"kind": "ORGANIC_PUBLICATION_BUNDLE_REPORT"/);
  const report = JSON.parse(result.stdout);
  assert.equal(report.kind, 'ORGANIC_PUBLICATION_BUNDLE_FAILURE');
  assert.equal(report.publicationReady, false);
  assert.equal(report.bundleComplete, false);
  assert.equal(report.deployed, false);
  return report;
}

function assertSuccess(result) {
  assert.equal(result.status, 0, result.stderr + '\n' + result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.kind, 'ORGANIC_PUBLICATION_BUNDLE_REPORT');
  assert.equal(report.deployed, false);
  assert.equal(report.bundleComplete, true);
  assert.equal(report.hostConfigurationValidated, false);
  assert.equal(report.hostConfiguration, 'not_validated');
  assert.equal(report.netlifyTomlIncluded, false);
  assert.equal(report.overwrite, false);
  assert.equal(report.homepageByteIdentical, true);
  return report;
}

function independentDigest(out, files) {
  const sorted = files.slice().sort((a, b) => a.path.localeCompare(b.path));
  const rows = [];
  for (const file of sorted) {
    const buf = fs.readFileSync(path.join(out, file.path));
    const digest = sha256(buf);
    assert.equal(file.sha256, digest, file.path);
    assert.equal(file.bytes, buf.length, file.path);
    rows.push(file.path + '\0' + digest);
  }
  return sha256(rows.join('\n'));
}

function cleanup(root, out) {
  fs.rmSync(root, { recursive: true, force: true });
  if (out) fs.rmSync(out, { recursive: true, force: true });
}

test('existing referenced SVG is copied and hashed', () => {
  const root = seedFixture();
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><text>og</text></svg>');
  writeMinimalHomepage(root, '<meta property="og:image" content="https://apprescue.ai/og-image.svg" />');
  writeFile(root, 'og-image.svg', svg);
  const out = path.join(os.tmpdir(), 'pub-out-svg-' + process.pid);
  fs.rmSync(out, { recursive: true, force: true });
  const result = runBuild(root, out);
  const report = assertSuccess(result);
  assert.ok(report.files.some((f) => f.path === 'og-image.svg'));
  assert.deepEqual(fs.readFileSync(path.join(out, 'og-image.svg')), svg);
  assert.equal(report.bundleDigestSha256, independentDigest(out, report.files));
  cleanup(root, out);
});

test('referenced missing SVG fails closed without a publication-ready report', () => {
  const root = seedFixture();
  writeMinimalHomepage(root, '<meta property="og:image" content="https://apprescue.ai/og-image.svg" />');
  const out = path.join(os.tmpdir(), 'pub-out-miss-svg-' + process.pid);
  fs.rmSync(out, { recursive: true, force: true });
  const result = runBuild(root, out);
  const fail = assertFailure(result, out);
  assert.ok(fail.missingPublicAssets.includes('og-image.svg'));
  cleanup(root);
});

test('referenced missing PNG fails closed without a publication-ready report', () => {
  const root = seedFixture();
  writeMinimalHomepage(root, '<meta property="og:image" content="/og-image.png" />');
  const out = path.join(os.tmpdir(), 'pub-out-miss-png-' + process.pid);
  fs.rmSync(out, { recursive: true, force: true });
  const result = runBuild(root, out);
  const fail = assertFailure(result, out);
  assert.ok(fail.missingPublicAssets.includes('og-image.png'));
  cleanup(root);
});

test('missing required route fails closed', () => {
  const root = seedFixture();
  fs.rmSync(path.join(root, 'resources/editorial-policy/index.html'));
  const out = path.join(os.tmpdir(), 'pub-out-miss-route-' + process.pid);
  fs.rmSync(out, { recursive: true, force: true });
  const result = runBuild(root, out);
  const fail = assertFailure(result, out);
  assert.ok(fail.missingPublicAssets.includes('resources/editorial-policy/index.html'));
  cleanup(root);
});

test('missing required calculator JS fails closed', () => {
  const root = seedFixture();
  fs.rmSync(path.join(root, 'resources/app-cost-calculator/cost-engine.js'));
  const out = path.join(os.tmpdir(), 'pub-out-miss-js-' + process.pid);
  fs.rmSync(out, { recursive: true, force: true });
  const result = runBuild(root, out);
  const fail = assertFailure(result, out);
  assert.ok(fail.missingPublicAssets.includes('resources/app-cost-calculator/cost-engine.js'));
  cleanup(root);
});

test('selected-file symlink is refused and outside-root bytes are not copied', () => {
  const root = seedFixture();
  const outside = path.join(os.tmpdir(), 'pub-outside-engine-' + process.pid + '.txt');
  const marker = Buffer.from('OUTSIDE-ROOT-ENGINE-BYTES\n');
  fs.writeFileSync(outside, marker);
  const target = path.join(root, 'resources/app-cost-calculator/cost-engine.js');
  fs.rmSync(target);
  fs.symlinkSync(outside, target);
  const out = path.join(os.tmpdir(), 'pub-out-file-symlink-' + process.pid);
  fs.rmSync(out, { recursive: true, force: true });
  const result = runBuild(root, out);
  const fail = assertFailure(result, out);
  assert.ok(fail.rejectedSymlinks.includes('resources/app-cost-calculator/cost-engine.js'));
  assert.equal(fs.existsSync(path.join(out, 'resources/app-cost-calculator/cost-engine.js')), false);
  cleanup(root);
  fs.rmSync(outside, { force: true });
});

test('ancestor-directory symlink is refused', () => {
  const root = seedFixture();
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pub-outside-calc-'));
  fs.writeFileSync(path.join(outsideDir, 'index.html'), 'OUTSIDE-INDEX');
  fs.writeFileSync(path.join(outsideDir, 'cost-engine.js'), 'OUTSIDE-ENGINE');
  const calc = path.join(root, 'resources/app-cost-calculator');
  fs.rmSync(calc, { recursive: true, force: true });
  fs.symlinkSync(outsideDir, calc);
  const out = path.join(os.tmpdir(), 'pub-out-anc-symlink-' + process.pid);
  fs.rmSync(out, { recursive: true, force: true });
  const result = runBuild(root, out);
  const fail = assertFailure(result, out);
  assert.ok(fail.rejectedSymlinks.includes('resources/app-cost-calculator'));
  cleanup(root, out);
  fs.rmSync(outsideDir, { recursive: true, force: true });
});

test('optional unreferenced favicon symlink is excluded without copying outside bytes', () => {
  const root = seedFixture();
  const outside = path.join(os.tmpdir(), 'pub-outside-favicon-' + process.pid + '.ico');
  fs.writeFileSync(outside, Buffer.from('OUTSIDE-FAVICON-BYTES'));
  fs.symlinkSync(outside, path.join(root, 'favicon.ico'));
  const out = path.join(os.tmpdir(), 'pub-out-opt-symlink-' + process.pid);
  fs.rmSync(out, { recursive: true, force: true });
  const result = runBuild(root, out);
  const report = assertSuccess(result);
  assert.ok(report.optionalSymlinksExcluded.includes('favicon.ico'));
  assert.ok(!report.files.some((f) => f.path === 'favicon.ico'));
  assert.equal(fs.existsSync(path.join(out, 'favicon.ico')), false);
  cleanup(root, out);
  fs.rmSync(outside, { force: true });
});

test('referenced optional favicon symlink is refused', () => {
  const root = seedFixture();
  writeMinimalHomepage(root, '<link rel="icon" href="/favicon.ico" />');
  const outside = path.join(os.tmpdir(), 'pub-outside-favicon-ref-' + process.pid + '.ico');
  fs.writeFileSync(outside, Buffer.from('OUTSIDE-FAVICON-REF'));
  fs.symlinkSync(outside, path.join(root, 'favicon.ico'));
  const out = path.join(os.tmpdir(), 'pub-out-opt-ref-symlink-' + process.pid);
  fs.rmSync(out, { recursive: true, force: true });
  const result = runBuild(root, out);
  const fail = assertFailure(result, out);
  assert.ok(fail.rejectedSymlinks.includes('favicon.ico'));
  cleanup(root);
  fs.rmSync(outside, { force: true });
});

test('pre-existing output dir/file/symlink bytes are preserved', () => {
  const root = seedFixture();
  writeMinimalHomepage(root, '');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pub-preexist-'));

  const existingDir = path.join(tmp, 'dir');
  fs.mkdirSync(existingDir);
  const dirMarker = Buffer.from('EXISTING-DIR-MARKER');
  fs.writeFileSync(path.join(existingDir, 'keep.bin'), dirMarker);
  const dirResult = runBuild(root, existingDir);
  assert.equal(dirResult.status, 1);
  assert.match(dirResult.stderr, /Refusing to overwrite/);
  assert.deepEqual(fs.readFileSync(path.join(existingDir, 'keep.bin')), dirMarker);
  assert.deepEqual(fs.readdirSync(existingDir), ['keep.bin']);

  const existingFile = path.join(tmp, 'file.bin');
  const fileMarker = Buffer.from('EXISTING-FILE-MARKER');
  fs.writeFileSync(existingFile, fileMarker);
  const fileResult = runBuild(root, existingFile);
  assert.equal(fileResult.status, 1);
  assert.match(fileResult.stderr, /Refusing to overwrite/);
  assert.deepEqual(fs.readFileSync(existingFile), fileMarker);

  const linkTarget = path.join(tmp, 'link-target.bin');
  const linkMarker = Buffer.from('EXISTING-SYMLINK-TARGET');
  fs.writeFileSync(linkTarget, linkMarker);
  const existingLink = path.join(tmp, 'out-link');
  fs.symlinkSync(linkTarget, existingLink);
  const linkResult = runBuild(root, existingLink);
  assert.equal(linkResult.status, 1);
  assert.match(linkResult.stderr, /Refusing to overwrite/);
  assert.equal(fs.lstatSync(existingLink).isSymbolicLink(), true);
  assert.deepEqual(fs.readFileSync(linkTarget), linkMarker);

  cleanup(root);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('allowlist, exclusions, and independently recalculated digest', () => {
  const root = seedFixture();
  writeFile(root, 'README.md', 'not public');
  writeFile(root, 'BASELINE.md', 'not public');
  writeFile(root, 'netlify.toml', '[[headers]]');
  writeFile(root, 'CHANGELOG.md', 'not public');
  writeFile(root, 'resources/pilot-manifest.json', '{"kind":"PUBLIC_EDITORIAL_MANIFEST"}');
  writeFile(root, 'tests/secret.test.cjs', 'not public');
  writeFile(root, 'scripts/not-public.cjs', 'not public');
  writeFile(root, '.git', 'gitdir: /tmp/not-a-git-dir\n');
  writeFile(root, 'node_modules/pkg/index.js', 'not public');
  const favicon = Buffer.from('FAVICON-BYTES');
  writeFile(root, 'favicon.ico', favicon);
  const out = path.join(os.tmpdir(), 'pub-out-allow-' + process.pid);
  fs.rmSync(out, { recursive: true, force: true });
  const result = runBuild(root, out);
  const report = assertSuccess(result);
  const copied = report.files.map((f) => f.path).sort();
  assert.deepEqual(copied, REQUIRED_ROUTES.concat(['favicon.ico']).sort());
  for (const rel of FORBIDDEN_PUBLIC) {
    assert.ok(!report.files.some((f) => f.path === rel), rel);
    assert.equal(fs.existsSync(path.join(out, rel)), false, rel);
  }
  assert.equal(fs.existsSync(path.join(out, '.git')), false);
  assert.equal(fs.existsSync(path.join(out, 'node_modules')), false);
  assert.equal(report.bundleDigestSha256, independentDigest(out, report.files));
  assert.deepEqual(fs.readFileSync(path.join(out, 'favicon.ico')), favicon);
  cleanup(root, out);
});

test('current homepage bytes are preserved when referenced PNG is present', () => {
  const root = seedFixture();
  const homepage = fs.readFileSync(path.join(REPO, 'index.html'));
  fs.writeFileSync(path.join(root, 'index.html'), homepage);
  writeFile(root, 'og-image.png', Buffer.from('SYNTHETIC-OG-PNG'));
  const out = path.join(os.tmpdir(), 'pub-out-home-' + process.pid);
  fs.rmSync(out, { recursive: true, force: true });
  const result = runBuild(root, out);
  const report = assertSuccess(result);
  assert.deepEqual(fs.readFileSync(path.join(out, 'index.html')), homepage);
  assert.equal(report.homepageByteIdentical, true);
  assert.ok(report.files.some((f) => f.path === 'og-image.png'));
  assert.equal(report.bundleDigestSha256, independentDigest(out, report.files));
  cleanup(root, out);
});

test('composed-like fixture copies favicon and referenced SVG', () => {
  const root = seedFixture();
  writeMinimalHomepage(
    root,
    '<link rel="icon" href="/favicon.ico" />' +
    '<meta property="og:image" content="https://apprescue.ai/og-image.svg" />' +
    '<meta name="twitter:image" content="https://apprescue.ai/og-image.svg" />'
  );
  const favicon = Buffer.from('COMPOSED-FAVICON');
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><text>composed</text></svg>');
  writeFile(root, 'favicon.ico', favicon);
  writeFile(root, 'og-image.svg', svg);
  const out = path.join(os.tmpdir(), 'pub-out-composed-' + process.pid);
  fs.rmSync(out, { recursive: true, force: true });
  const result = runBuild(root, out);
  const report = assertSuccess(result);
  assert.ok(report.files.some((f) => f.path === 'favicon.ico'));
  assert.ok(report.files.some((f) => f.path === 'og-image.svg'));
  assert.deepEqual(fs.readFileSync(path.join(out, 'favicon.ico')), favicon);
  assert.deepEqual(fs.readFileSync(path.join(out, 'og-image.svg')), svg);
  assert.deepEqual(
    fs.readFileSync(path.join(out, 'index.html')),
    fs.readFileSync(path.join(root, 'index.html'))
  );
  assert.equal(report.bundleDigestSha256, independentDigest(out, report.files));
  for (const rel of REQUIRED_ROUTES) {
    assert.ok(report.files.some((f) => f.path === rel), rel);
  }
  cleanup(root, out);
});

test('remote artwork URLs are not followed and output inside source is refused', () => {
  const root = seedFixture();
  writeMinimalHomepage(root, '<meta property="og:image" content="https://evil.example/og-image.svg" />');
  const outInside = path.join(root, 'public-bundle');
  const inside = runBuild(root, outInside);
  assert.equal(inside.status, 1);
  assert.match(inside.stderr, /Refusing out-dir inside source root/);
  assert.equal(fs.existsSync(outInside), false);

  const out = path.join(os.tmpdir(), 'pub-out-remote-' + process.pid);
  fs.rmSync(out, { recursive: true, force: true });
  const result = runBuild(root, out);
  const report = assertSuccess(result);
  assert.ok(!report.files.some((f) => f.path === 'og-image.svg'));
  assert.ok(!report.referencedHomepageAssets.includes('og-image.svg'));
  cleanup(root, out);
});
