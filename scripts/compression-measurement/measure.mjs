// Measure how uncompressed JS sizes map to bytes on the wire, to calibrate the
// bundler optimizer's concave wire-size curve wire(m) = r∞·m + (r0−r∞)·min(m, w).
// No dependencies. See README.md for usage and interpretation.
import {readFileSync, readdirSync, existsSync, writeFileSync} from 'node:fs';
import {join, basename} from 'node:path';
import {createHash} from 'node:crypto';
import zlib from 'node:zlib';

const options = {
  gzipLevel: 9,
  brotliQuality: 11,
  maxFiles: 250,
  maxFileSize: 4 * 1024 * 1024,
  pairs: 80,
  prefixCap: 6 * 1024 * 1024,
  prefixPoints: 20,
  seed: 42,
  include: null,
  out: null,
};
const inputs = [];
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--gzip-level') options.gzipLevel = Number(args[++i]);
  else if (a === '--brotli-quality') options.brotliQuality = Number(args[++i]);
  else if (a === '--max-files') options.maxFiles = Number(args[++i]);
  else if (a === '--max-file-size') options.maxFileSize = Number(args[++i]);
  else if (a === '--pairs') options.pairs = Number(args[++i]);
  else if (a === '--prefix-cap') options.prefixCap = Number(args[++i]);
  else if (a === '--prefix-points') options.prefixPoints = Number(args[++i]);
  else if (a === '--seed') options.seed = Number(args[++i]);
  else if (a === '--include') options.include = new RegExp(args[++i]);
  else if (a === '--out') options.out = args[++i];
  else inputs.push(a);
}
if (!inputs.length) {
  console.error('usage: node measure.mjs <dir-or-file>... [--include <regex>] [--out results.json]');
  process.exit(1);
}

let seed = options.seed >>> 0;
const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);

const gzip = buf => zlib.gzipSync(buf, {level: options.gzipLevel}).length;
const brotli = buf =>
  zlib.brotliCompressSync(buf, {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: options.brotliQuality,
      [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length,
    },
  }).length;

// Collect .js files, dedup identical content, stride-sample across the size
// range so small and large files are both represented.
function collect(path, files) {
  const entries = readdirSync(path, {withFileTypes: true});
  for (const entry of entries) {
    const p = join(path, entry.name);
    if (entry.isDirectory() && !entry.isSymbolicLink()) collect(p, files);
    else if (entry.isFile() && p.endsWith('.js')) files.push(p);
  }
}
let paths = [];
for (const input of inputs) {
  if (existsSync(input) && readdirIfDir(input)) collect(input, paths);
  else paths.push(input);
}
function readdirIfDir(p) {
  try {
    readdirSync(p);
    return true;
  } catch {
    return false;
  }
}
if (options.include) paths = paths.filter(p => options.include.test(p));
const seen = new Set();
let files = [];
let oversized = 0;
for (const path of paths.sort()) {
  const buf = readFileSync(path);
  if (buf.length < 64) continue;
  if (buf.length > options.maxFileSize) {
    oversized++;
    continue;
  }
  const hash = createHash('sha1').update(buf).digest('hex');
  if (seen.has(hash)) continue;
  seen.add(hash);
  files.push({path, buf, size: buf.length});
}
files.sort((a, b) => a.size - b.size || (a.path < b.path ? -1 : 1));
if (files.length > options.maxFiles) {
  const sampled = [];
  for (let i = 0; i < options.maxFiles; i++) {
    sampled.push(files[Math.floor((i * files.length) / options.maxFiles)]);
  }
  files = sampled;
}
if (files.length < 4) {
  console.error(`only ${files.length} usable files found`);
  process.exit(1);
}
console.error(`measuring ${files.length} files (${oversized} skipped over size cap)...`);
for (const f of files) {
  f.gzip = gzip(f.buf);
  f.brotli = brotli(f.buf);
}

// --- Model fitting ------------------------------------------------------
// Weighted least squares on y ≈ c1·t1(m) + c2·t2(m) with weights 1/y², so
// relative error is minimized and small files are not drowned out.
function fit(points, t1, t2) {
  let a11 = 0, a12 = 0, a22 = 0, b1 = 0, b2 = 0;
  for (const {m, y} of points) {
    const w = 1 / (y * y);
    const x1 = t1(m);
    const x2 = t2 ? t2(m) : 0;
    a11 += w * x1 * x1;
    a12 += w * x1 * x2;
    a22 += w * x2 * x2;
    b1 += w * x1 * y;
    b2 += w * x2 * y;
  }
  if (!t2) return [b1 / a11, 0];
  const det = a11 * a22 - a12 * a12;
  if (Math.abs(det) < 1e-12) return null;
  return [(b1 * a22 - b2 * a12) / det, (b2 * a11 - b1 * a12) / det];
}

const quantile = (xs, q) => {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
};

function errors(points, predict) {
  const rel = points.map(({m, y}) => Math.abs(predict(m) - y) / y);
  return {median: quantile(rel, 0.5), p90: quantile(rel, 0.9)};
}

const GRID = Array.from({length: 25}, (_, i) => 256 * Math.pow(4096, i / 24)); // 256B..1MB

function fitModels(points) {
  const models = {};
  const [linear] = fit(points, m => m);
  models.linear = {params: {r: linear}, ...errors(points, m => linear * m)};
  {
    const c = fit(points, m => m, () => 1);
    if (c && c[1] >= 0) {
      models.linearOverhead = {params: {r: c[0], h: c[1]}, ...errors(points, m => c[0] * m + c[1])};
    }
  }
  for (const [name, term] of [
    ['twoPiece', w => m => Math.min(m, w)],
    ['smooth', w => m => 1 - Math.exp(-m / w)],
  ]) {
    let best = null;
    for (const w of GRID) {
      const t2 = term(w);
      const c = fit(points, m => m, t2);
      if (!c || c[0] < 0 || c[1] < 0) continue;
      const e = errors(points, m => c[0] * m + c[1] * t2(m));
      if (!best || e.median < best.median) best = {params: {r: c[0], k: c[1], w}, ...e};
    }
    if (best) models[name] = best;
  }
  return models;
}

function describe(models, codec) {
  const lines = [];
  const pct = x => (x * 100).toFixed(1) + '%';
  for (const [name, m] of Object.entries(models)) {
    let params;
    if (name === 'linear') params = `r=${m.params.r.toFixed(4)}`;
    else if (name === 'linearOverhead') {
      params = `r=${m.params.r.toFixed(4)} h=${m.params.h.toFixed(0)}B`;
    } else if (name === 'twoPiece') {
      params = `r∞=${m.params.r.toFixed(4)} r0=${(m.params.r + m.params.k).toFixed(4)} w=${(m.params.w / 1024).toFixed(1)}KB`;
    } else {
      params = `r=${m.params.r.toFixed(4)} h=${m.params.k.toFixed(0)}B w=${(m.params.w / 1024).toFixed(1)}KB`;
    }
    lines.push(`  ${codec} ${name.padEnd(14)} ${params.padEnd(44)} median err ${pct(m.median)}, p90 ${pct(m.p90)}`);
  }
  return lines.join('\n');
}

const gzipPoints = files.map(f => ({m: f.size, y: f.gzip}));
const brotliPoints = files.map(f => ({m: f.size, y: f.brotli}));
const gzipModels = fitModels(gzipPoints);
const brotliModels = fitModels(brotliPoints);

// --- Prefix curve: within-content shape, covering the small-size region ---
console.error('prefix curve...');
const corpus = Buffer.concat(files.flatMap(f => [f.buf, Buffer.from('\n')]));
const cap = Math.min(corpus.length, options.prefixCap);
const prefix = [];
for (let i = 0; i < options.prefixPoints; i++) {
  const size = Math.round(512 * Math.pow(cap / 512, i / (options.prefixPoints - 1)));
  const slice = corpus.subarray(0, size);
  prefix.push({m: size, gzip: gzip(slice), brotli: brotli(slice)});
}
const prefixGzip = fitModels(prefix.map(p => ({m: p.m, y: p.gzip})));
const prefixBrotli = fitModels(prefix.map(p => ({m: p.m, y: p.brotli})));

// --- Pairwise merge savings: the decision-relevant quantity ---------------
console.error('merge pairs...');
const pairs = [];
const used = new Set();
let attempts = 0;
while (pairs.length < options.pairs && attempts++ < options.pairs * 50) {
  const a = files[random() % files.length];
  const b = files[random() % files.length];
  const key = a.path < b.path ? a.path + b.path : b.path + a.path;
  if (a === b || used.has(key) || a.size + b.size > options.maxFileSize * 2) continue;
  used.add(key);
  const merged = Buffer.concat([a.buf, Buffer.from('\n'), b.buf]);
  pairs.push({
    small: Math.min(a.size, b.size),
    total: a.size + b.size,
    gzipSaving: a.gzip + b.gzip - gzip(merged),
    brotliSaving: a.brotli + b.brotli - brotli(merged),
  });
}

// Fit the warmup term of the two-piece curve directly to measured merge
// savings: saving ≈ k·(min(a,w) + min(b,w) − min(a+b,w)). This is the
// decision-relevant calibration; per-file scatter conflates content
// compressibility with warmup and overestimates merge savings.
function fitPairs(saving) {
  let best = null;
  for (const w of GRID) {
    const t = p => Math.min(p.small, w) + Math.min(p.total - p.small, w) - Math.min(p.total, w);
    let num = 0, den = 0;
    for (const p of pairs) {
      num += t(p) * saving(p);
      den += t(p) * t(p);
    }
    if (den === 0) continue;
    const k = Math.max(0, num / den);
    const rel = pairs.map(p => Math.abs(k * t(p) - saving(p)) / Math.max(saving(p), 64));
    const e = quantile(rel, 0.5);
    if (!best || e < best.median) best = {k, w, median: e};
  }
  return best;
}

function mergeReport(codec, saving, model) {
  if (!model) return `  ${codec}: no two-piece fit`;
  const {r, k, w} = model.params;
  const predict = p => k * (Math.min(p.total - p.small, w) + Math.min(p.small, w) - Math.min(p.total, w));
  const buckets = [
    ['small<4KB', p => p.small < 4096],
    ['4-32KB', p => p.small >= 4096 && p.small < 32768],
    ['>=32KB', p => p.small >= 32768],
  ];
  const lines = [];
  for (const [label, filter] of buckets) {
    const subset = pairs.filter(filter);
    if (!subset.length) continue;
    const actual = subset.map(saving);
    const rel = subset.map(p => {
      const act = saving(p);
      return act > 0 ? Math.abs(predict(p) - act) / act : 1;
    });
    lines.push(
      `  ${codec} ${label.padEnd(10)} n=${String(subset.length).padEnd(3)} ` +
        `actual mean ${(actual.reduce((s, x) => s + x, 0) / actual.length / 1024).toFixed(1)}KB ` +
        `median ${(quantile(actual, 0.5) / 1024).toFixed(1)}KB, model median err ${(quantile(rel, 0.5) * 100).toFixed(0)}%`
    );
  }
  return lines.join('\n');
}

// --- Source map factor: output bytes per source byte ----------------------
const ratios = [];
for (const f of files) {
  const mapPath = f.path + '.map';
  if (!existsSync(mapPath)) continue;
  try {
    const map = JSON.parse(readFileSync(mapPath, 'utf8'));
    // Flat maps carry sourcesContent directly; index maps nest one flat map
    // per section. Sections referencing external maps by url are skipped.
    const flats = Array.isArray(map.sections) ? map.sections.map(s => s.map).filter(Boolean) : [map];
    let source = 0;
    for (const flat of flats) {
      if (!Array.isArray(flat.sourcesContent)) continue;
      for (const s of flat.sourcesContent) if (typeof s === 'string') source += Buffer.byteLength(s);
    }
    if (source > 0) ratios.push(f.size / source);
  } catch {
    // ignore unreadable maps
  }
}

// --- Report ---------------------------------------------------------------
const totalRaw = files.reduce((s, f) => s + f.size, 0);
const totalGzip = files.reduce((s, f) => s + f.gzip, 0);
const totalBrotli = files.reduce((s, f) => s + f.brotli, 0);
const kb = x => (x / 1024).toFixed(1) + 'KB';
console.log(`# Compression measurement`);
console.log(`corpus: ${files.length} files, ${(totalRaw / 1048576).toFixed(1)}MB; sizes ${kb(files[0].size)}..${kb(files[files.length - 1].size)}`);
console.log(`settings: gzip -${options.gzipLevel}, brotli -q${options.brotliQuality}, seed ${options.seed}`);
console.log(`aggregate ratio: gzip ${(totalGzip / totalRaw).toFixed(3)}, brotli ${(totalBrotli / totalRaw).toFixed(3)}\n`);
console.log(`## Per-file model fits (whole-corpus scatter)`);
console.log(describe(gzipModels, 'gzip  '));
console.log(describe(brotliModels, 'brotli'));
console.log(`\n## Prefix-curve fits (within-content shape, ${kb(512)}..${kb(cap)})`);
console.log(describe(prefixGzip, 'gzip  '));
console.log(describe(prefixBrotli, 'brotli'));
console.log(`\n## Pairwise merge savings vs two-piece prediction (${pairs.length} pairs)`);
console.log(mergeReport('gzip  ', p => p.gzipSaving, gzipModels.twoPiece));
console.log(mergeReport('brotli', p => p.brotliSaving, brotliModels.twoPiece));
const pairFitGzip = fitPairs(p => p.gzipSaving);
const pairFitBrotli = fitPairs(p => p.brotliSaving);
console.log(`\n## Warmup fit on merge savings directly (recommended for the optimizer)`);
for (const [codec, f] of [['gzip  ', pairFitGzip], ['brotli', pairFitBrotli]]) {
  if (!f) continue;
  console.log(
    `  ${codec} k=r0−r∞=${f.k.toFixed(4)} w=${(f.w / 1024).toFixed(1)}KB ` +
      `(merging two ${(f.w / 1024).toFixed(0)}KB+ files saves ~${((f.k * f.w) / 1024).toFixed(2)}KB), median err ${(f.median * 100).toFixed(0)}%`
  );
}
if (ratios.length) {
  console.log(`\n## Output bytes per source-map source byte (${ratios.length} files)`);
  console.log(
    `  median ${quantile(ratios, 0.5).toFixed(3)}, p10 ${quantile(ratios, 0.1).toFixed(3)}, p90 ${quantile(ratios, 0.9).toFixed(3)}`
  );
}

if (options.out) {
  writeFileSync(
    options.out,
    JSON.stringify(
      {
        options: {...options, include: options.include?.source ?? null},
        files: files.map(({path, size, gzip, brotli}) => ({path, size, gzip, brotli})),
        prefix,
        pairs,
        sourceRatios: ratios,
        fits: {
          perFile: {gzip: gzipModels, brotli: brotliModels},
          prefix: {gzip: prefixGzip, brotli: prefixBrotli},
          pairs: {gzip: pairFitGzip, brotli: pairFitBrotli},
        },
      },
      null,
      2
    )
  );
  console.error(`\nwrote ${options.out}`);
}
