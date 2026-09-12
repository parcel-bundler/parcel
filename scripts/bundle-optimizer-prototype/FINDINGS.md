# Initial findings

These are the version 1 findings. The current runner adds further fixtures and
session policies; see [SESSION_FINDINGS.md](./SESSION_FINDINGS.md). The original
80 seeded inputs and legacy strategies remain available for comparison. The
15-graph sensitivity figures below refer to the original fixture set.

Reproduce with `node scripts/bundle-optimizer-prototype/run.mjs` using the
defaults in `README.md`: 30 KB minimum, 25 requests, cumulative extra-byte
allowance of the smaller of 10 KB or 5%, source/dependency change rates 1:0.1,
duplicate weight 0.1, and cache weight 1. The suite contains eight explicit
graphs and 80 seeded graphs across four families. The parameter sweep adds
17 settings on 15 graphs, including held-out seeds 101–102.

These are synthetic results, not estimates of browser latency or evidence that
this graph distribution represents production applications.

## Shared-host absorption produces most of the benefit

Changes in corpus means versus selective smallest-first duplication:

| Strategy                          | Cold bytes | Emitted duplicates | Route-transition bytes | One-edit redownload bytes |
| --------------------------------- | ---------- | ------------------ | ---------------------- | ------------------------- |
| Shared-host cover                 | 0.0%       | -39.9%             | -4.7%                  | -21.3%                    |
| Greedy hybrid                     | +0.2%      | -44.1%             | -5.4%                  | -22.9%                    |
| Hybrid with final-layout fallback | +0.2%      | -44.5%             | -5.4%                  | -23.2%                    |
| Unbounded Jaccard                 | +12.5%     | -100.0%            | -13.8%                 | -3.3%                     |

All strategies satisfied both constraints on all 80 seeded graphs. The
mandatory-floor fixture is deliberately infeasible and remains so.

The emitted-duplication reduction is much larger than the route-transition
download reduction. They should not be presented as equivalent performance
gains. The independent correlated-group edit model also improves: -31.2% for
cover and -34.8% for the guarded hybrid versus the baseline.

Cover is a useful first production increment. Bounded unions add benefit,
especially in the overlapping-consumer family, but contribute less than cover
in this particular suite.

## Pairwise greedy unions can produce a dominated final result

The `budget-chain` fixture starts with ten 4 KB bundles on ten routes. Every
bundle omits two routes. A complete union would add 8 KB per route, exceeding
the 7.6 KB allowance (5% of each original 152 KB activation).

The unguarded hybrid chooses several locally cheap unions. It cannot grow
those unions to 30 KB within the cumulative budget, so it eventually duplicates
them. Compared with the baseline, the finished result has:

- 154.4 KB rather than 152.0 KB average cold downloads;
- 304 KB rather than 280 KB emitted duplicates;
- worse transition and edit downloads as well.

The guarded variant compares completed smallest-first, cover, and hybrid
layouts under the same objective and selects a simpler layout here. This
guarantees no worse configured objective than those alternatives when feasible,
not no regression in every individual metric or global optimality.

A more targeted future approach would evaluate whether a proposed cluster can
reach the minimum within budget before committing its first pairwise union.

## The source/dependency heuristic is useful, but not the dominant gain

In `hot-helper`, the cache penalty keeps a 2 KB application helper out of a
500 KB dependency bundle. Disabling it selects the union instead. On the 80
seeded graphs, adding the cache term reduces the one-edit metric from 29.8 KB
to 28.7 KB and the independent group-edit metric from 36.4 KB to 35.0 KB.

The localized-pressure family exposes a tradeoff: the cache-aware optimizer
chooses slightly more duplicated bytes than smallest-first (497.8 KB versus
492.1 KB) to improve one-edit redownloads (20.2 KB versus 22.3 KB). This is
intentional under the objective, not a universal win.

The independence assumption and graph-wide footprint weight deserve more
testing. Package-level change rates and actual navigation traces would give
more realistic signals without changing the transformation machinery.

## An over-fetch guard is necessary

In `size-trap`, consumer-set Jaccard is 0.9 for a 5 KB and 500 KB bundle.
The unbounded union adds 500 KB to one route. The bounded policies reject it.
Across generated graphs Jaccard eliminates duplication, but increases mean
cold downloads by 12.5%.

Its lower transition bytes partly reflect prefetching code on the first route.
Read that metric alongside the higher cold-load cost.

## The minimum-size threshold has a substantial cost

On the fixed sensitivity corpus, increasing the minimum from 15 KB to 60 KB
increases mean emitted duplication from 202.2 KB to 928.1 KB and transition
downloads from 323.5 KB to 371.5 KB. Mean maximum requests falls from 11.5 to
7.6. This shows the expected exchange; this simulator does not model the
network/request overhead needed to decide which threshold is faster.

The next useful input is a dump of real Parcel post-placement graphs, followed
by real compressed sizes and browser loading measurements. The CLI already
accepts custom graph JSON; production integration is deliberately outside this
prototype.
