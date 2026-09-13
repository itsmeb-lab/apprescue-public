#!/usr/bin/env node
/* Host-independent static bundle for the organic utility pilot.
 * Fail-closed: missing required inputs or unresolved local homepage assets
 * do not emit a publication-ready report or an output tree.
 * Symlink / non-regular checks use lstat on each selected path component at
 * validation and copy time. That is not claimed to be race-proof.
 * Never overwrites an existing out-dir/file/symlink. Never deploys.
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

const SKIP_DIR_NAMES = new Set(['.git', 'node_modules', 'tests', 'scripts']);
const SKIP_FILES = new Set([
  'README.md',
  'BASELINE.md',
  'netlify.toml',
  'resources/pilot-manifest.json',
  'CHANGELOG.md',
  'changelog',
  'CHANGELOG'
]);
const PUBLIC_BASE = [
  'index.html',
  'release-evidence/index.html'
];
const FAVICON_CANDIDATES = ['favicon.ico', 'favicon.png', 'favicon.svg', 'favicon.jpg'];
const OG_IMAGE_CANDIDATES = ['og-image.svg', 'og-image.png'];
const HOMEPAGE_ASSET_CANDIDATES = FAVICON_CANDIDATES.concat(OG_IMAGE_CANDIDATES);
const RESOURCE_PUBLIC = [
  'resources/index.html',
  'resources/app-cost-calculator/index.html',
  'resources/app-cost-calculator/cost-engine.js',
  'resources/ai-app-running-costs/index.html',
  'resources/app-portability-checklist/index.html',
  'resources/editorial-policy/index.html',
  'resources/sitemap.xml'
];
const REQUIRED_PUBLIC = PUBLIC_BASE.concat(RESOURCE_PUBLIC);
const SAME_ORIGIN_HOSTS = new Set(['apprescue.ai', 'www.apprescue.ai']);

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function lexists(abs) {
  try {
    fs.lstatSync(abs);
    return true;
  } catch (err) {
    if (err && err.code === 'ENOENT') return false;
    throw err;
  }
}

function pathIsInsideOrEqual(parent, child) {
  const p = path.resolve(parent);
  const c = path.resolve(child);
  if (p === c) return true;
  const rel = path.relative(p, c);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function assertRelativeSafe(rel) {
  if (typeof rel !== 'string' || rel.length === 0) {
    return { ok: false, reason: 'invalid-rel', message: 'Invalid selected source path.' };
  }
  if (path.isAbsolute(rel)) {
    return { ok: false, reason: 'absolute', message: 'Selected source path must be relative: ' + rel };
  }
  const parts = rel.split(/[/\\]/);
  if (parts.some((part) => part === '' || part === '.' || part === '..')) {
    return { ok: false, reason: 'invalid-rel', message: 'Selected source path is not a bounded relative path: ' + rel };
  }
  return { ok: true, parts };
}

function inspectSelectedSource(root, rel) {
  const safe = assertRelativeSafe(rel);
  if (!safe.ok) return safe;
  const rootAbs = path.resolve(root);
  let current = rootAbs;
  for (let i = 0; i < safe.parts.length; i += 1) {
    current = path.resolve(current, safe.parts[i]);
    if (!pathIsInsideOrEqual(rootAbs, current) || current === rootAbs) {
      return {
        ok: false,
        reason: 'escapes-root',
        rel,
        message: 'Selected source path escapes authenticated root: ' + rel
      };
    }
    let st;
    try {
      st = fs.lstatSync(current);
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        return { ok: false, reason: 'missing', rel, message: 'Missing required public input: ' + rel };
      }
      throw err;
    }
    const component = safe.parts.slice(0, i + 1).join('/');
    if (st.isSymbolicLink()) {
      return {
        ok: false,
        reason: 'symlink',
        rel,
        component,
        message: 'Refusing symlink in selected source path component "' + component + '" for ' + rel
      };
    }
    if (i < safe.parts.length - 1) {
      if (!st.isDirectory()) {
        return {
          ok: false,
          reason: 'not-directory',
          rel,
          component,
          message: 'Selected source ancestor is not a directory: ' + component
        };
      }
    } else if (!st.isFile()) {
      return {
        ok: false,
        reason: 'not-regular-file',
        rel,
        message: 'Selected source is not a regular file: ' + rel
      };
    }
  }
  return { ok: true, rel, abs: current };
}

function walk(dir, acc) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  } catch (err) {
    return acc;
  }
  for (const entry of entries) {
    if (entry.name === '.git') continue;
    if (entry.isSymbolicLink()) continue;
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

function mapLocalOrSameOriginAsset(rawUrl) {
  if (typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('data:') || trimmed.startsWith('mailto:') || trimmed.startsWith('javascript:')) {
    return null;
  }
  if (trimmed.startsWith('//')) return null;
  let pathname;
  if (/^https?:\/\//i.test(trimmed)) {
    let parsed;
    try {
      parsed = new URL(trimmed);
    } catch (err) {
      return null;
    }
    if (!SAME_ORIGIN_HOSTS.has(parsed.hostname.toLowerCase())) return null;
    pathname = parsed.pathname || '';
  } else {
    pathname = trimmed.split('#')[0].split('?')[0];
  }
  pathname = pathname.replace(/\\/g, '/');
  if (pathname.startsWith('./')) pathname = pathname.slice(2);
  if (pathname.startsWith('/')) pathname = pathname.slice(1);
  if (!pathname || pathname.includes('/') || pathname.includes('..')) return null;
  if (HOMEPAGE_ASSET_CANDIDATES.includes(pathname)) return pathname;
  return null;
}

function referencedHomepageAssets(html) {
  const found = new Set();
  const attrRe = /\b(?:href|src|content|poster|srcset)\s*=\s*(["'])([\s\S]*?)\1/gi;
  let match;
  while ((match = attrRe.exec(html))) {
    const attr = match[0];
    const value = match[2];
    if (/\bsrcset\s*=/i.test(attr)) {
      for (const part of value.split(',')) {
        const token = part.trim().split(/\s+/)[0];
        const mapped = mapLocalOrSameOriginAsset(token);
        if (mapped) found.add(mapped);
      }
    } else {
      const mapped = mapLocalOrSameOriginAsset(value);
      if (mapped) found.add(mapped);
    }
  }
  const cssRe = /url\(\s*(['"]?)([\s\S]*?)\1\s*\)/gi;
  while ((match = cssRe.exec(html))) {
    const mapped = mapLocalOrSameOriginAsset(match[2]);
    if (mapped) found.add(mapped);
  }
  return found;
}

function writeFailure(payload) {
  const report = Object.assign({
    kind: 'ORGANIC_PUBLICATION_BUNDLE_FAILURE',
    publicationReady: false,
    bundleComplete: false,
    deployed: false,
    overwrite: false,
    hostConfigurationValidated: false,
    hostConfiguration: 'not_validated'
  }, payload);
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}

function failAndExit(payload, lines) {
  for (const line of lines) console.error(line);
  writeFailure(payload);
  process.exit(1);
}

const outDir = path.resolve(outDirArg);
if (pathIsInsideOrEqual(ROOT, outDir)) {
  failAndExit({
    outDir,
    errors: ['Refusing out-dir inside source root: ' + outDir]
  }, ['Refusing out-dir inside source root: ' + outDir]);
}
if (lexists(outDir)) {
  failAndExit({
    outDir,
    errors: ['Refusing to overwrite existing out-dir: ' + outDir]
  }, ['Refusing to overwrite existing out-dir: ' + outDir]);
}

const errors = [];
const missingPublic = [];
const rejectedSymlinks = [];
const optionalSymlinksExcluded = [];

function recordInspectFailure(info, required) {
  errors.push(info.message);
  if (info.reason === 'missing') missingPublic.push(info.rel);
  if (info.reason === 'symlink') rejectedSymlinks.push(info.component || info.rel);
  if (!required && info.reason === 'missing') return;
}

for (const rel of REQUIRED_PUBLIC) {
  const info = inspectSelectedSource(ROOT, rel);
  if (!info.ok) recordInspectFailure(info, true);
}

let homepage = '';
const homepageInfo = inspectSelectedSource(ROOT, 'index.html');
if (homepageInfo.ok) {
  homepage = fs.readFileSync(homepageInfo.abs, 'utf8');
}

const referencedAssets = homepageInfo.ok ? referencedHomepageAssets(homepage) : new Set();
const selectedHomepageAssets = [];

for (const name of HOMEPAGE_ASSET_CANDIDATES) {
  const referenced = referencedAssets.has(name);
  const info = inspectSelectedSource(ROOT, name);
  if (info.ok) {
    selectedHomepageAssets.push(name);
    continue;
  }
  if (referenced) {
    if (info.reason === 'missing') {
      errors.push('Unresolved local homepage asset: ' + name);
      missingPublic.push(name);
    } else {
      recordInspectFailure(info, true);
    }
  } else if (info.reason === 'symlink') {
    optionalSymlinksExcluded.push(name);
  }
}

if (errors.length > 0) {
  failAndExit({
    outDir,
    errors,
    missingPublicAssets: [...new Set(missingPublic)],
    rejectedSymlinks: [...new Set(rejectedSymlinks)],
    optionalSymlinksExcluded,
    referencedHomepageAssets: [...referencedAssets].sort()
  }, errors);
}

const selected = REQUIRED_PUBLIC.concat(selectedHomepageAssets);
const inventory = walk(ROOT, []);
const excluded = inventory.filter((rel) => (
  SKIP_FILES.has(rel) ||
  rel.startsWith('tests/') ||
  rel.startsWith('scripts/')
));
const excludedFromBundle = [...new Set(excluded.concat([
  'resources/pilot-manifest.json',
  'netlify.toml',
  'README.md',
  'BASELINE.md',
  '.git',
  'tests',
  'scripts',
  'node_modules'
]))];

const preserved = [];
const copied = [];

function copySelected(rel) {
  const info = inspectSelectedSource(ROOT, rel);
  if (!info.ok) {
    throw new Error(info.message);
  }
  const buf = fs.readFileSync(info.abs);
  const to = path.join(outDir, rel);
  if (!pathIsInsideOrEqual(outDir, to) || to === outDir) {
    throw new Error('Refusing to write outside out-dir: ' + rel);
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.writeFileSync(to, buf);
  const digest = sha256(buf);
  copied.push({ path: rel, sha256: digest, bytes: buf.length });
  if (PUBLIC_BASE.includes(rel) || HOMEPAGE_ASSET_CANDIDATES.includes(rel)) {
    preserved.push({ path: rel, sha256: digest });
  }
}

fs.mkdirSync(outDir, { recursive: true });
try {
  for (const rel of selected) copySelected(rel);
} catch (err) {
  failAndExit({
    outDir,
    errors: [String(err && err.message ? err.message : err)],
    missingPublicAssets: [...new Set(missingPublic)],
    rejectedSymlinks: [...new Set(rejectedSymlinks)]
  }, [String(err && err.message ? err.message : err)]);
}

copied.sort((a, b) => a.path.localeCompare(b.path));
const digestSource = copied.map((f) => f.path + '\0' + f.sha256).join('\n');
const bundleDigest = sha256(digestSource);

const homepageSrc = sha256(fs.readFileSync(inspectSelectedSource(ROOT, 'index.html').abs));
const homepageOutInfo = inspectSelectedSource(outDir, 'index.html');
if (!homepageOutInfo.ok) {
  failAndExit({
    outDir,
    errors: ['Homepage copy is not a regular file under out-dir.']
  }, ['Homepage copy is not a regular file under out-dir.']);
}
const homepageOut = sha256(fs.readFileSync(homepageOutInfo.abs));
if (homepageSrc !== homepageOut) {
  failAndExit({
    outDir,
    errors: ['Homepage copy is not byte-identical.']
  }, ['Homepage copy is not byte-identical.']);
}

const report = {
  kind: 'ORGANIC_PUBLICATION_BUNDLE_REPORT',
  outDir,
  overwrite: false,
  deployed: false,
  bundleComplete: true,
  hostConfigurationValidated: false,
  hostConfiguration: 'not_validated',
  netlifyTomlIncluded: false,
  inventoryCount: inventory.length,
  inventory,
  preservedPublicAssets: preserved,
  missingPublicAssets: [],
  rejectedSymlinks: [],
  optionalSymlinksExcluded,
  referencedHomepageAssets: [...referencedAssets].sort(),
  excludedFromBundle,
  files: copied,
  allowlist: selected,
  finitePublicRoutes: REQUIRED_PUBLIC.slice(),
  homepageAssetCandidates: HOMEPAGE_ASSET_CANDIDATES.slice(),
  bundleDigestSha256: bundleDigest,
  homepageByteIdentical: homepageSrc === homepageOut
};
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
