# Bundle optimizer prototype

A dependency-free simulator of Parcel's proposed **post-placement** bundle
optimization. It imports no Parcel implementation code. Run with Node 20+.

See [FINDINGS.md](./FINDINGS.md) for the original experiment and
[SESSION_FINDINGS.md](./SESSION_FINDINGS.md) for the session/intersection comparison.

```sh
node scripts/bundle-optimizer-prototype/run.mjs
node --test scripts/bundle-optimizer-prototype/model.test.mjs
```

The default experiment compares eleven strategies on thirteen explicit graphs
and 80 generated graphs. It also runs 17 legacy parameter settings on 20 graphs
and 12 paired session settings on 11 graphs (three policies per setting). It writes:

- `results/report.md`: comparisons, per-family results, decision traces,
  sensitivity analysis, and regressions.
- `results/summary.csv`: one row per graph and strategy.
- `results/results.json`: all metrics, plus full inputs, layouts, and decision
  traces for explicit graphs. Generated inputs are reproducible from seeds.
- `results/example-graph.json`: editable input for a focused experiment.

Generated files live in this prototype's ignored `results/` directory.

## Change an experiment

```sh
# Larger reproducible suite; 100 seeds in each of four families.
node scripts/bundle-optimizer-prototype/run.mjs --seeds 100 --no-sweep

# Compare the first increment against the guarded hybrid with no over-fetching.
node scripts/bundle-optimizer-prototype/run.mjs --seeds 10 --no-sweep \
  --strategies smallest-first,cover,hybrid-guarded \
  --config '{"maxExtraBytes":0,"maxRequests":15}' --out /tmp/bundle-zero-extra

# Edit the exported graph, then compare all strategies on it.
node scripts/bundle-optimizer-prototype/run.mjs \
  --input scripts/bundle-optimizer-prototype/results/example-graph.json \
  --out /tmp/bundle-custom

# Compare transformations using the same session objective, with a lower
# equivalent request cost. These policies all retain root/cover fallbacks.
node scripts/bundle-optimizer-prototype/run.mjs --no-sweep \
  --strategies smallest-first,session-cover,session-intersection,session-union \
  --config '{"requestCost":20000,"firstPageLoadPriority":0.67}' \
  --out /tmp/bundle-session-comparison
```

`--help` lists all options. JSON configuration may also be read with
`--config-file`. A custom input can be one graph or an array of graphs.

## Model and deliberate simplifications

A graph has roots (loading contexts), assets, and physical bundles. An asset has
an estimated byte size, a `source` boolean corresponding to `IS_SOURCE`, a
compatibility label, and an optional synthetic change group. A bundle contains
asset indices and lists the contexts that load it. Root weights default to one.

The generator coalesces identical consumer signatures, including singleton JS
sets with their entries, as Parcel's placement phase would. Mandatory bundles
remain addressable and cannot acquire new consumers; entries can absorb assets.
Only matching compatibility labels can merge.

These incidence graphs stand in for **already resolved transitive loading
closures after availability filtering**. There is no module dependency graph,
lazy execution ordering, CSS application, cycle analysis, inline output,
packaging, minification, compression, or content-hash propagation. Every listed
bundle is assumed to require one request and compatible optional bundles are
assumed safe to merge or duplicate. This is an optimization experiment, not a
proof that the corresponding transformation is safe in Parcel.

All cold byte counts include full physical bundles; module execution deduplication
does not avoid downloading another copy. Asset presence and mandatory boundaries
are checked after every accepted transformation. Request counts never increase in
any context. Unsatisfiable limits are reported, never silently relaxed.

## Strategies

| Strategy               | Behavior                                                                                                                                                                                                                    |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `all-roots`            | Smallest-first; eliminate an offending shared bundle globally by copying into every entry that loads it.                                                                                                                    |
| `smallest-first`       | Globally duplicate undersized bundles; for request pressure copy only into the overloaded context, retaining the shared bundle elsewhere. This approximates the proposed conservative baseline, not every Parcel v2 detail. |
| `cover`                | Score-based duplication plus greedy absorption into disjoint existing hosts. No extra cold bytes.                                                                                                                           |
| `hybrid`               | Cover plus pairwise union merges with a cumulative extra-byte budget.                                                                                                                                                       |
| `hybrid-guarded`       | Run smallest-first, cover, and hybrid; select a feasible finished layout with the lowest configured cost. Preserves the unguarded hybrid as a comparator.                                                                   |
| `hybrid-no-cache`      | Same hybrid but cache cost does not influence decisions. Cache metrics are still reported using the common evaluation configuration.                                                                                        |
| `jaccard`              | Prefer the most similar overlapping consumer sets and allow unbounded extra bytes. Root duplication is a fallback. An intentionally naive comparator.                                                                       |
| `session-cover`        | Existing-host absorption and root duplication, scored by session downloads, requests, and edit invalidation. No extra cold bytes.                                                                                           |
| `session-intersection` | Same objective and fallbacks, plus a merged output for overlapping consumers and separate outputs for both residual consumer sets. No extra cold bytes.                                                                     |
| `session-union`        | Same session objective and fallbacks, plus bounded union merges; no intersection operation.                                                                                                                                 |
| `session-combined`     | Same session objective with both intersection and union candidates.                                                                                                                                                         |

Set cover is greedy and restricted to **disjoint** hosts, so no activation
downloads two copies due to a cover operation. Full and selective absorption
are candidates. Union/intersection candidates must share at least one context.
Optional bundles below the minimum, and bundles touching an overloaded context,
initiate candidate generation. The legacy policies reduce excess requests or
undersized file count. Session policies count undersized **bundle/context
occurrences**, because intersection merging may increase the global file count.
Every operation strictly reduces the sum of physical requests across contexts
and never increases any context's request count. This bounds termination even
when an intersection creates more files. Hard size/request limits still apply
to the completed layout, including residual chunks.

All policies stop once both limits are met by default. For a separate economic
optimization experiment, `optimizeBeyondLimits: true` lets session policies
consider any optional bundle and continue strictly cost-improving moves after
the limits are satisfied. Legacy policies ignore this flag. Keeping it disabled
in the main comparison isolates scoring and transformations from this additional
change in stopping behavior.

An intersection of A serving `{0,1,2}` and B serving `{1,2,3}` creates AB serving
`{1,2}`, A serving `{0}`, and B serving `{3}`. Empty residuals are omitted. The
module sets and mandatory entry boundaries remain unchanged; each context
downloads only the content it originally needed. This is a conceptual
Turbopack-style operation, not a reproduction of its bounded search, overlap
ranking, or leftover packing algorithm.

Once unions exist, absorbed bundles can contain unneeded assets for some of
their consumers. Those bytes continue to count against the original budget.
The `budget-chain` fixture intentionally reveals that locally cheap unions can
hit a dead end below the minimum size, then be duplicated into a worse final
layout. The guarded variant chooses the cheaper completed alternative; it does
not claim global optimality or improvement in every individual metric.

## Objective and units

Defaults:

```json
{
  "minSize": 30000,
  "maxRequests": 25,
  "maxExtraBytes": 10000,
  "maxExtraRatio": 0.05,
  "sourceRate": 1,
  "dependencyRate": 0.1,
  "duplicateWeight": 0.1,
  "cacheWeight": 1,
  "firstPageLoadPriority": 0.67,
  "requestCost": 200000,
  "sessionDuplicateWeight": 0,
  "optimizeBeyondLimits": false
}
```

These are experiment settings, not empirically tuned production defaults. The
200 KB-equivalent request cost is a comparison starting point from Turbopack's
model, not an estimate of HTTP headers, compression savings, or actual latency.
It is deliberately swept down to zero. Its optimal calibration need not carry
over to different transformations or candidate eligibility rules.

```
cost(layout) = expected cold bytes per activation
             + duplicateWeight × total emitted duplicate bytes
             + cacheWeight × expected bytes redownloaded after one edit

candidate score = (cost(after) - cost(before))
                / (excess requests removed + undersized bundles removed)
```

The expression above is retained for legacy strategies. Session strategies use:

```
session cost = expected bytes downloaded over a session
             + requestCost × expected requests over a session
             + cacheWeight × expected bytes redownloaded after one edit
             + sessionDuplicateWeight × total emitted duplicate bytes
```

Within the session policies, beneficial candidates are ranked by total cost
reduction. If a move must increase cost to meet constraints, rank its cost per
excess request or undersized occurrence removed. Every strategy's finished
layout reports **both** `legacyCost` and `sessionCost` under common configured
weights; the generic `cost` field denotes that strategy's optimization objective.
Use `sessionCost` for cross-strategy session comparisons.

The footprint term is a graph-wide quantity, while cold and edit costs are
weighted per-activation quantities. Consequently its coefficient is sensitive to
graph size. This is explicit rather than claiming all terms predict latency.

For every context, cumulative extra bytes relative to the original layout must
remain below **both** `maxExtraBytes` and `maxExtraRatio × original bytes`.
This includes duplicated downloads and unneeded code. Jaccard is exempt solely
to reveal what an unbounded policy does. Set either allowance to zero to prohibit
extra bytes. Protected outputs are exempt from minimum size but count as requests.

## Cache and navigation measurements

**One-edit bytes (optimizer objective):** Choose exactly one asset to edit,
proportionally to its source/dependency rate. For each context, invalidate every
loaded physical bundle containing that asset and count its full bytes once.
Average over normalized context weights. Equivalently:

```
bundle rate = sum(asset rates)
expected edited bytes = sum(bundle bytes × bundle rate × consumer weight)
                      / sum(all unique asset rates)
```

This normalizes the earlier relative-rate heuristic into bytes per synthetic
edit event. It assumes assets change independently and ignores cascading hashes.
It counts changed plus unchanged bytes in invalidated bundles; duplicating an
asset can invalidate several physical bundles.

**Group-edit bytes (evaluation only):** Choose one synthetic change group and
change all its assets together. Use the maximum asset rate as its group rate,
then invalidate affected bundles once. A group is an original generated module
group; it is not a real npm package. This checks whether gains survive a simple
correlated-change model that the optimizer does not score.

**Session and transition bytes:** Sample a first root using normalized root
weights. A session has one activation with probability `firstPageLoadPriority`
and two otherwise. For the second activation, sample from the conditional row
`graph.transitions[first]`. Without an explicit matrix, choose a different root
proportionally to its weight. A singleton graph stays on its only root.

Load the first with an empty HTTP cache, then download physical files absent
from that cache for the second. Copies of identical assets in different outputs
still download again. Report conditional second-activation bytes/requests and
the full session bytes/requests separately. Algebraically:

```
sessionBytes = coldBytes + (1 - firstPageLoadPriority) × transitionBytes
```

Each per-root transition row is normalized independently. This preserves the
first-root distribution with nonuniform root weights, unlike globally
normalizing products of distinct-root weights. The session score uses these
navigation costs; the original policies only report them for evaluation.

An optional transition matrix is an N×N array of nonnegative relative weights,
with a positive row sum. Rows are first roots, columns are second roots. Self
transitions are permitted and reuse their cached files. For three roots:

```json
"transitions": [[0, 9, 1], [9, 0, 1], [1, 1, 0]]
```

The two `navigation-*` fixtures have identical modules and initial root weights
but different transition matrices. Twenty-three protected requests leave one
optional JS request under the default cap, forcing the merge decision. The
`large-overlap-pressure` fixture scales shared sizes tenfold without changing
its consumer sets or edit weights. These isolate effects beyond the original
small-chunk generated graphs.

The edit-invalidation term remains a separate synthetic update scenario, not an
event inserted into the two-activation session. Its multiplier is a configurable
tradeoff. No emitted component alternatives, module-level loaded tracking, or
adaptive runtime fetching are modeled.

No metric is a browser latency estimate. A reduction in emitted duplicates need
not yield a similar percentage reduction in downloads. Session scores value all
requests, but candidates remain constraint-driven unless
`optimizeBeyondLimits` is enabled. All protected outputs count toward each
activation's request ceiling; a whole two-activation session can exceed it.

## Files

- `model.mjs`: transformations, greedy optimizer, invariants, and metrics.
- `graphs.mjs`: exact-signature placement, adversarial fixtures, seeded families.
- `run.mjs`: CLI, paired comparisons, sensitivity runs, and reports.
- `model.test.mjs`: analytical examples, counterexamples, and seeded invariants.

The experiment is deterministic in layouts and metrics. Timing is measured once
locally and includes validation/evaluation overhead; it is neither deterministic
nor a benchmark of a potential Rust implementation.
