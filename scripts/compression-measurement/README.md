# Compression measurement

Measures how uncompressed JS sizes map to bytes on the wire, to calibrate a
concave wire-size curve for the bundler optimizer's cost function:

```
wire(m) = r∞·m + (r0 − r∞)·min(m, w)
```

`r∞` is the asymptotic compression ratio, and the warmup term charges the
first `w` bytes of each file at the worse ratio `r0`. The warmup term is what
prices consolidation: merging two files saves roughly
`(r0 − r∞)·min(m_small, w)` transfer bytes per download.

## Usage

```sh
node scripts/compression-measurement/measure.mjs <dist-dir>... \
  [--include <regex>] [--max-files N] [--pairs N] [--out results.json]
```

Point it at production build output (`dist/`). `--include '\.min\.js$'` limits
a directory scan to matching paths. `--gzip-level` (default 9) and
`--brotli-quality` (default 11) select static-precompression settings; lower
them to model dynamic CDN compression. Duplicate file contents are dropped and
the corpus is stride-sampled across the size range.

## What it measures

- **Per-file model fits**: compressed size of every file, fit by four models
  (linear, linear+overhead, two-piece, exponential saturation). Comparing
  their errors answers whether the two-piece curve is adequate.
- **Prefix curve**: compresses log-spaced prefixes of the concatenated corpus,
  giving the within-content curve shape and covering the small-size region
  even when the corpus has no small files.
- **Pairwise merge savings**: `c(A) + c(B) − c(A‖B)` over sampled pairs — the
  decision-relevant quantity — and a direct fit of `(k, w)` on those savings.
  Per-file scatter fits conflate "small files hold less-compressible content"
  with warmup and overestimate merge savings; prefer the pair fit for the
  optimizer's parameters, with `r∞` taken from the aggregate ratio.
- **Source-map factor**: output bytes per source byte from `.map`
  `sourcesContent`, estimating the constant that converts the optimizer's raw
  estimates into output bytes (fit parameters are in output units; divide `w`
  and multiply ratios by this factor to convert).

## Caveats

Merge savings between unrelated files (library corpora) underestimate savings
between same-app bundles, which share framework and wrapper boilerplate.
Calibrate on real application dist output, and note whether that build is
minified: an unminified corpus compresses with different ratios.
