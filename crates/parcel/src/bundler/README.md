# Parcel v3 bundle consolidation

The default bundler first groups assets by their required loading roots. After
dependency wiring, it consolidates shared JavaScript payloads to reduce small
files and excessive requests. The same policy runs in development and production.

Configure it in the project's `.parcelrc`:

```json
{
  "extends": "@parcel/config-default",
  "bundler": {
    "plugin": "@parcel/bundler-default",
    "config": {
      "minBundleSize": 30000,
      "maxParallelRequests": 25,
      "firstPageLoadPriority": 0.67,
      "dependencyChangeRate": 0.1,
      "manualSharedBundles": []
    }
  }
}
```

| Option                  | Meaning                                                                                                                                                                                                                                                                |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `minBundleSize`         | Minimum estimated bytes for eligible shared JS payloads. `0` disables this constraint.                                                                                                                                                                                 |
| `maxParallelRequests`   | Maximum physical requests in each eager loading closure, including its root and parallel dependencies. `0` disables this constraint.                                                                                                                                   |
| `firstPageLoadPriority` | A number from `0` to `1`: probability of one activation rather than two. Higher values prioritize cold loads; lower values give more weight to reuse between activations.                                                                                              |
| `dependencyChangeRate`  | A number from `0` to `1`: relative edit frequency for assets without `AssetFlags::IS_SOURCE`. Source assets have weight `1`. Zero ignores dependency edits.                                                                                                            |
| `manualSharedBundles`   | Ordered grouping rules with `assets` glob patterns and optional `types`. These outputs neither donate nor receive assets during consolidation.                                                                                                                         |
| `compression`           | `"none"` (default), `"gzip"`, or `"brotli"`: the transfer compression bundles are served with. Selects the wire-size curve applied to sizes in cost estimates; non-`none` values also reward consolidating disjoint payloads (about 1KB of transfer per file removed). |

Sizes come from `Content::estimate_size()`: buffer byte lengths, file metadata,
or the retained parser input size for JS/CSS ASTs. Estimation avoids printing
ASTs, packaging, minifying, or compressing content. These are estimates, not final transfer sizes. Non-JS outputs
retain their existing packaging behavior and count toward request limits when
eagerly loaded. Their constant byte costs do not affect JS merge comparisons.

## Policy

- Consider small shared payloads and payloads loaded by an over-budget context.
- Absorb a payload into existing compatible hosts, including shared hosts, or
  duplicate it into consumers. A selective move may retain the original file
  for consumers that still need it.
- Require matching packagers and targets. Preserve entry execution, lazy and URL
  addresses, stable names, inline/isolated boundaries, and manual grouping.
  This initial policy merges registration-only JS payloads; it does not merge
  CSS, raw resources, or independently addressable lazy bundles.
- Reject extra downloads in any existing loading context, extra copies within
  a context, new reference cycles, and moves that increase any request count.
- Rank beneficial moves by total cost reduction. Rank unavoidable increases by
  cost per excess request or undersized bundle/context occurrence removed.
- Accept a move only if it strictly reduces the remaining violations or
  strictly reduces the cost, worsening neither. Cost-reducing merges rank ahead
  of cost-increasing relief, so relief decisions see deduplicated sizes. With
  `compression: "none"` the wire curve is linear and only moves that
  deduplicate an asset can reduce cost, so beyond the limits only payloads
  overlapping another output are considered; a concave curve keeps every
  donor eligible.
- Run one greedy pass to a fixed point: stop when no acceptable move remains.
  Every accepted move strictly reduces the total request count over all
  contexts, bounding progress. This is a greedy heuristic, not a global
  optimum. A smallest-first fallback strategy and a separate post-search
  polish phase were folded into this single pass after simulation over
  ~51,000 graphs: versus the guarded two-strategy policy, the single pass
  improved 33 outcomes and regressed the 27 the fallback had won, all by at
  most ~2% of estimated cost, with roughly unchanged search time and less
  code. Reintroduce a completed-run comparison only with evidence at scale.

The cost is expected session JS transfer plus expected transfer invalidated by
one edit. Activations are sampled uniformly from loadable roots; a second
activation, when present, samples a different root. HTTP cache reuse follows
physical file identity, so identical modules in two files still cost two
downloads. Edit probability is proportional to source/dependency weights, and
an edit invalidates each complete file containing that asset. Transfer applies
the configured compression's two-piece wire-size curve to estimated sizes: the
first bytes of each file compress at a worse ratio, so each extra file costs
about 1KB of transfer, and consolidation pays until that flat saving is
outweighed by the merged file's larger edit-invalidation blast radius. The
curve parameters were fitted on a production react-spectrum storybook build by
`scripts/compression-measurement` (7-8% median per-file error, cross-validated
against measured pairwise merge savings). There is no soft request penalty, so
consolidation is never driven by request count alone; beyond the configured
constraints only strict cost reductions are kept.

After consolidation, bundle indices and references are remapped consistently.
Synthetic loaders and synchronous import bindings use stable bundle/asset
identities independently of bundle ordering. Incremental tests cross the size threshold in both directions and
toggle `.parcelrc` settings, comparing every output with a fresh build.

Some limits are infeasible while preserving loading boundaries and zero extra
downloads. The bundler keeps a correct layout and emits a warning reporting
the remaining excess requests and undersized eligible occurrences. The minimum
does not apply to protected outputs. The request limit is a loading-graph
constraint, not a simulation of browser scheduling, compression, or latency.

Intersection outputs, over-fetching budgets, runtime constituent loading,
measured navigation weights, and package-specific edit rates remain future
experiments. Fixture examples live under `tests/fixtures/bundler/merge-*`;
their `options.config` explicitly selects the fixture's `.parcelrc`.

Availability and internalization fixtures whose shared payloads would otherwise
be consolidated set `minBundleSize: 0` in their own `.parcelrc`. This preserves
their original placement and reference assertions. Consolidated entry cycles
are covered separately by `merge-entry-cycle`, including independent execution
of each entry in development and production.

## Implementation costs

Candidate layouts share asset and reference lists with copy-on-write storage,
so evaluating a move copies only the lists it changes. Live/protected/host sets
are packed bitsets. Traversal and asset-membership scratch buffers are reused;
source reachability and host prices are computed once per source.

Candidate state evaluation updates cached sizes, edit rates, and eager asset
dependency edges for changed hosts. Only the source's existing loading contexts
are retraversed: all changed hosts and referencing parents were already loaded
by subsets of those contexts. Each candidate stores a sparse delta of changed
consumer bitsets, root totals, and bundle score contributions. Only the winning
delta is applied. Retraversal preserves alternate-path and cycle handling without
an additional reachability matrix. Costs are summed in the original bundle order
to preserve floating-point tie-breaking.

Unit tests compare every candidate, including rejected candidates, against the
full state calculation. The manual timing test disables that oracle.

A manual simulated-workload timing check covers small graphs, many assets,
many roots, narrow and broad sharing, and layouts already within the limits:

```sh
cargo test -p parcel --release --lib optimizer_workload_timings -- --ignored --nocapture
```
