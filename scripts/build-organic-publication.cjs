#!/usr/bin/env node
/* Host-independent static bundle for the organic utility pilot.
 * Never overwrites an existing out-dir. Never deploys.
 * Usage: node scripts/build-organic-publication.cjs <fresh-out-dir>
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const outDirArg = process.argv[2];
if (!outDirArg) {
  console.error('Usage: node scripts/build-organic-publication.cjs <fresh-out-dir>');
  process.exit(2);
}
const outDir = path.resolve(outDirArg);
if (fs.existsSync(outDir)) {
  console.error('Refusing to overwrite existing out-dir: ' + outDir);
  process.exit(1);
}

const SKIP_DIR_NAMES = new Set(['.git', 'node_modules', 'tests', 'scripts']);
const SKIP_FILES = new Set([
  'README.md',
  'BASELINE.md',
  'netlify.toml',
  'resources/pilot-manifest.json'
]);
const PUBLIC_BASE = [
  'index.html',
  'release-evidence/index.html'
];
const FAVICON_CANDIDATES = ['favicon.ico', 'favicon.png', 'favicon.svg', 'favicon.jpg'];
const RESOURCE_PUBLIC = [
  'resources/index.html',
  'resources/app-cost-calculator/index.html',
  'resources/app-cost-calculator/cost-engine.js',
  'resources/ai-app-running-costs/index.html',
  'resources/app-portability-checklist/index.html',
  'resources/editorial-policy/index.html',
  'resources/sitemap.xml'
];

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function walk(dir, acc) {
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (entry.name === '.git') continue;
    const rel = path.relative(ROOT, path.join(dir, entry.name)).split(path.sep).join('/');
    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name)) continue;
      walk(path.join(dir, entry.name), acc);
    } else if (entry.isFile()) {
      acc.push(rel);
    }
  }
  return acc;
}

const inventory = walk(ROOT, []);
const expectedPublic = PUBLIC_BASE.slice();
for (const name of FAVICON_CANDIDATES) {
  if (inventory.includes(name)) expectedPublic.push(name);
}
const missingPublic = expectedPublic.filter((rel) => !inventory.includes(rel));
const homepage = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const referencedAssets = [];
if (homepage.includes('/og-image.png') && !inventory.includes('og-image.png')) referencedAssets.push('og-image.png');
const preserved = [];
const copied = [];
const excluded = inventory.filter((rel) => SKIP_FILES.has(rel) || rel.startsWith('tests/') || rel.startsWith('scripts/'));

function copyFile(rel) {
  const from = path.join(ROOT, rel);
  if (!fs.existsSync(from)) {
    missingPublic.push(rel);
    return;
  }
  const to = path.join(outDir, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  const buf = fs.readFileSync(from);
  fs.writeFileSync(to, buf);
  const digest = sha256(buf);
  copied.push({ path: rel, sha256: digest, bytes: buf.length });
  if (PUBLIC_BASE.includes(rel) || FAVICON_CANDIDATES.includes(rel)) preserved.push({ path: rel, sha256: digest });
}

fs.mkdirSync(outDir, { recursive: true });
for (const rel of expectedPublic) copyFile(rel);
for (const rel of RESOURCE_PUBLIC) copyFile(rel);

copied.sort((a, b) => a.path.localeCompare(b.path));
const digestSource = copied.map((f) => f.path + '\0' + f.sha256).join('\n');
const bundleDigest = sha256(digestSource);

const homepageSrc = sha256(fs.readFileSync(path.join(ROOT, 'index.html')));
const homepageOut = sha256(fs.readFileSync(path.join(outDir, 'index.html')));
if (homepageSrc !== homepageOut) {
  console.error('Homepage copy is not byte-identical.');
  process.exit(1);
}

const report = {
  kind: 'ORGANIC_PUBLICATION_BUNDLE_REPORT',
  outDir,
  overwrite: false,
  deployed: false,
  inventoryCount: inventory.length,
  inventory,
  preservedPublicAssets: preserved,
  missingPublicAssets: [...new Set(missingPublic.concat(referencedAssets))],
  excludedFromBundle: excluded.concat(['resources/pilot-manifest.json']),
  files: copied,
  allowlist: expectedPublic.concat(RESOURCE_PUBLIC),
  bundleDigestSha256: bundleDigest,
  homepageByteIdentical: homepageSrc === homepageOut
};
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
