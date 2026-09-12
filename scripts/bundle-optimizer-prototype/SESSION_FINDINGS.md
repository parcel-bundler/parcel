# Session and intersection experiment

Version 2 adds intersection/residual outputs, an explicit one-/two-activation
session objective, and paired comparisons with shared-host absorption and
bounded unions. Runtime loading is unchanged: reuse is strictly by physical
file identity, with no knowledge of constituent modules or alternative outputs.

Run `node scripts/bundle-optimizer-prototype/run.mjs` to reproduce the full
report, JSON layouts/traces, CSV summary, and sensitivity experiments. The
suite has 13 explicit graphs and the same 80 seeded graphs as version 1, plus
17 legacy sensitivity settings and 12 paired session settings. Each paired
setting evaluates the three policies on the same 11 graphs.

## What is compared

All three policies use identical session probabilities, transitions, cost
coefficients, constraints, and greedy ranking rules:

- **session-cover:** root duplication and absorption into existing shared hosts.
- **session-intersection:** the same fallbacks plus new outputs for intersections,
  retaining separate A-only and B-only outputs.
- **session-union:** the same fallbacks plus unions subject to the cumulative
  extra-byte budget, without intersection merging.

An additional `session-combined` policy allows both transformations. The seven
legacy policies remain available and are evaluated under the same session
metric, even though their decisions use their original objective.

The default first-load probability is 0.67; otherwise there are two activations.
The initial root is sampled from its weight, then the next root is sampled from
a conditional transition row. The request cost starts at 200,000 equivalent
bytes and is swept downward. Source/dependency edit weights remain 1:0.1.
Emitted duplication has zero weight in the session objective by default.

By default, optimization stops once the minimum-size and maximum-request limits
are satisfied. Continuing beyond them is an explicitly separate experiment
(`optimizeBeyondLimits: true`). This is not an exact reimplementation of
Turbopack's candidate eligibility, overlap ranking, or leftover packing.

## Main corpus: scoring matters more than intersection candidates at these settings

Means over the original 80 seeded graphs, with the default 30 KB minimum,
25-request ceiling, and 200 KB-equivalent request cost:

| Policy                   | Session downloads KB | Session requests | Emitted duplicates KB | One-edit redownload KB |
| ------------------------ | -------------------- | ---------------- | --------------------- | ---------------------- |
| Selective smallest-first | 906.9                | 9.79             | 1044.7                | 37.3                   |
| Legacy shared-host cover | 899.4                | 10.51            | 628.2                 | 29.3                   |
| Legacy guarded hybrid    | 899.4                | 10.68            | 580.1                 | 28.6                   |
| Session cover            | 905.7                | 9.50             | 885.5                 | 31.9                   |
| Session intersection     | 905.7                | 9.50             | 885.5                 | 31.9                   |
| Session union            | 905.7                | 9.50             | 876.7                 | 31.8                   |

The intersection and cover policies produce the same metrics on this corpus at
the default setting. Bounded unions add very little here. The session objective
prefers fewer requests to the additional sharing retained by the legacy cost
function. That is a tradeoff, not a demonstrated latency improvement.

All policies satisfy both limits on the 80 seeded inputs. The deliberately
infeasible mandatory-floor case remains infeasible. Lower-cap legacy sweeps can
also make the protected-resource navigation fixtures infeasible; the report
retains these cases rather than dropping them.

## Intersection becomes useful as request cost falls

Matched session sensitivity runs on 11 graphs, including larger chunks and
explicit navigation patterns:

| Request cost (equiv. bytes) | Intersection moves | Cover cost (equiv. KB) | Intersection cost (equiv. KB) | Union cost (equiv. KB) |
| --------------------------- | ------------------ | ---------------------- | ----------------------------- | ---------------------- |
| 0                           | 55                 | 1343.2                 | 1337.9                        | 1342.2                 |
| 5000                        | 10                 | 1404.0                 | 1401.1                        | 1403.2                 |
| 20000                       | 2                  | 1579.2                 | 1578.0                        | 1578.5                 |
| 50000                       | 1                  | 1923.7                 | 1922.9                        | 1922.2                 |
| 200000                      | 0                  | 3632.4                 | 3632.4                        | 3626.5                 |

Compare policies within a row: changing request cost changes the objective's
units/weighting, so costs across rows are not directly comparable.

At zero request cost, the intersection policy reduces mean emitted duplication
from 393.2 KB to 312.8 KB relative to session cover, and mean session downloads
from 1303.6 KB to 1301.1 KB. Even then, it must consolidate enough to meet the
hard request limit. At higher request costs it tends to choose root/host
absorption instead, which can save requests across more consumers.

This argues for keeping request cost configurable and benchmarking its
calibration, not copying the 200 KB coefficient as an established optimum.

## Navigation alone changes the merge decision

Two fixtures have the same code and equally weighted first roots:

- A is needed by roots 0, 1, 4, 5; B by roots 2, 3, 4, 5.
- Each chunk is 80 KB.
- Root entries plus 23 protected resource requests leave one optional JS request
  under the default cap. Both graphs therefore require consolidation.

At request cost 20,000, the together fixture navigates within pairs needing A,
B, or A+B. Intersection merging retains A for 0/1, B for 2/3, and AB for 4/5:

| Navigation | Policy       | Session downloads KB | Session requests | Session cost (equiv. KB) |
| ---------- | ------------ | -------------------- | ---------------- | ------------------------ |
| Together   | Cover        | 298.1                | 25.33            | 830.4                    |
| Together   | Intersection | 289.3                | 25.33            | 817.8                    |
| Together   | Union        | 298.1                | 25.33            | 830.4                    |
| Apart      | Cover        | 315.7                | 25.44            | 850.2                    |
| Apart      | Intersection | 315.7                | 25.44            | 850.2                    |
| Apart      | Union        | 315.7                | 25.44            | 850.2                    |

For the apart fixture, transitions cross between exclusive and overlapping
consumers. The intersection policy selects selective duplication instead of
an intersection output. Content, first-load weights, and cost coefficients are
unchanged. Session request counts may exceed 25 because they include two
activations; each individual activation still satisfies the ceiling.

## Continuing beyond the limits is a different policy

On the same 11-graph sensitivity corpus, enabling further cost-improving merges
at request cost 200,000 changes session cover's mean session requests from
11.39 to 6.27, but emitted duplication rises from 612.8 KB to 4852.3 KB and
session downloads rise from 1310.6 KB to 1410.0 KB. This outcome is rewarded by
the chosen request coefficient; it is not automatically faster in a browser.

This behavior is exposed for experimentation but disabled in the main comparison.

## Greedy search still has limitations

Additional candidates do not guarantee a better finished layout. In the
all-two-activation sensitivity run, session union finishes with a higher
configured cost than session cover (4356.1 versus 4349.7 equivalent KB), despite
having access to cover candidates. The existing lesson about comparing finished
alternatives still applies; the new policies deliberately remain separate so
such regressions are visible.

## Validation and next evidence

Nineteen tests pass, including independent brute-force session replay with
nonuniform first-root weights, explicit transitions, all-one/all-two-activation
endpoints, physical-file cache identity, residual coverage, compatibility,
mandatory boundaries, request/byte limits, determinism, and finite progress when
intersection merging increases file count.

No browser timing, compression, dependency-order semantics, or constituent-aware
runtime loading is simulated. The new operation is worth retaining as a
candidate, but this experiment does not show a universal winner. Real
post-placement graphs and measured navigation distributions are the next useful
inputs before choosing production defaults.
