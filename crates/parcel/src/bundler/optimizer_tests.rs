use super::*;
use crate::bundler::tests::placement_bundles;

fn check(
  contents: &[&[u32]],
  references: &[&[usize]],
  roots: usize,
  sizes: &[usize],
  config: DefaultBundler,
  test: impl FnOnce(&mut Model, Layout),
) {
  let bundles = placement_bundles(contents);
  let layout = Layout::new(
    bundles.iter().map(|b| b.assets.clone()).collect(),
    references.iter().map(|r| r.to_vec()).collect(),
  );
  let mut protected = FixedBitSet::with_capacity(bundles.len());
  protected.insert_range(..roots);
  let mut model = Model {
    check_deltas: true,
    wire: WireCurve::new(config.compression),
    config: &config,
    bundles: &bundles,
    roots: (0..roots).collect(),
    protected,
    hosts: layout.live.clone(),
    packagers: vec![None; bundles.len()],
    sizes: sizes.to_vec(),
    rates: vec![1.0; sizes.len()],
    total_rate: sizes.len() as f64,
    asset_requests: vec![vec![]; sizes.len()],
  };
  test(&mut model, layout);
}

// An independent traversal checks asset coverage, including paths through copies.
fn loaded_assets(model: &Model, layout: &Layout, root: usize) -> Vec<AssetIndex> {
  let mut pending = vec![root];
  let mut seen = std::collections::HashSet::new();
  let mut assets = std::collections::BTreeSet::new();
  while let Some(b) = pending.pop() {
    assert!(layout.live.contains(b));
    if !seen.insert(b) {
      continue;
    }
    pending.extend(layout.references[b].iter());
    for a in layout.assets[b].iter() {
      assets.insert(*a);
      pending.extend(&model.asset_requests[a.index()]);
    }
  }
  assets.into_iter().collect()
}

#[test]
fn selective_request_relief_retains_the_shared_file_for_other_consumers() {
  check(
    &[&[0], &[1], &[2], &[3], &[4]],
    &[&[3, 4], &[3], &[4], &[], &[]],
    3,
    &[1000, 1000, 1000, 10, 100],
    DefaultBundler {
      min_bundle_size: 0,
      max_parallel_requests: 2,
      ..Default::default()
    },
    |model, initial| {
      let (result, state) = model.run(initial.clone(), model.state(&initial));
      assert_eq!(state.requests, [2, 2, 2]);
      assert_eq!(result.assets[0].as_slice(), [AssetIndex(0), AssetIndex(3)]);
      assert!(result.live.contains(3));
      assert_eq!(result.references[1].as_slice(), [3]);
      for root in 0..3 {
        assert_eq!(
          loaded_assets(model, &initial, root),
          loaded_assets(model, &result, root)
        );
      }
    },
  );
}

#[test]
fn overlapping_parallel_consumers_cannot_pay_for_request_relief_with_duplicate_bytes() {
  check(
    &[&[0], &[1], &[2], &[3]],
    &[&[1, 2], &[3], &[3], &[]],
    3,
    &[100, 100, 100, 10],
    DefaultBundler {
      max_parallel_requests: 2,
      ..Default::default()
    },
    |model, initial| {
      // Keep root 0 from hosting so protected roots 1 and 2 cannot donate
      // into it; this test is about rejecting bundle 3's duplication.
      model.hosts.set(0, false);
      let (result, state) = model.run(initial.clone(), model.state(&initial));
      assert_eq!(state.requests, [4, 2, 2]);
      assert_eq!(state.excess, 2);
      assert_eq!(result.assets, initial.assets);
      assert_eq!(result.references, initial.references);
    },
  );
}

#[test]
fn session_score_matches_explicit_sessions_and_single_asset_edits() {
  check(
    &[&[0], &[1], &[2], &[3]],
    &[&[3], &[3], &[], &[]],
    3,
    &[100, 200, 300, 50],
    // The expected costs below are computed from uncompressed sizes.
    DefaultBundler {
      compression: Compression::None,
      ..Default::default()
    },
    |model, layout| {
      let state = model.state(&layout);
      let loads: Vec<Vec<usize>> = (0..3)
        .map(|r| (0..4).filter(|&b| state.consumers[b].contains(r)).collect())
        .collect();
      let bytes = |bs: &[usize]| bs.iter().map(|&b| state.sizes[b] as f64).sum::<f64>();
      let mut session = 0.0;
      for a in 0..3 {
        session += model.config.first_page_load_priority * bytes(&loads[a]) / 3.0;
        for b in 0..3 {
          if a == b {
            continue;
          }
          let mut files = loads[a].clone();
          for &file in &loads[b] {
            if !files.contains(&file) {
              files.push(file);
            }
          }
          session += (1.0 - model.config.first_page_load_priority) * bytes(&files) / 6.0;
        }
      }
      let mut edit = 0.0;
      for changed in 0..4 {
        for files in &loads {
          for &b in files {
            if layout.assets[b].contains(&AssetIndex(changed)) {
              edit += state.sizes[b] as f64 / 12.0;
            }
          }
        }
      }
      assert!((state.cost - session - edit).abs() < 1e-9);
    },
  );
}

#[test]
fn generated_layouts_preserve_coverage_limits_and_the_completed_baseline() {
  let mut seed = 42u32;
  let mut random = || {
    seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
    seed
  };
  for _ in 0..40 {
    let contents: Vec<Vec<u32>> = (0..12).map(|a| vec![a]).collect();
    let mut refs = vec![vec![]; 12];
    for b in 4..12 {
      let mask = random() % 15 + 1;
      for r in 0..4 {
        if mask & (1 << r) != 0 {
          refs[r].push(b);
        }
      }
    }
    let sizes: Vec<_> = (0..12).map(|_| (random() % 100 + 1) as usize).collect();
    check(
      &contents.iter().map(Vec::as_slice).collect::<Vec<_>>(),
      &refs.iter().map(Vec::as_slice).collect::<Vec<_>>(),
      4,
      &sizes,
      DefaultBundler {
        min_bundle_size: 50,
        max_parallel_requests: 3,
        ..Default::default()
      },
      |model, initial| {
        let before = model.state(&initial);
        let (result, after) = model.run(initial.clone(), before.clone());
        let (again, _) = model.run(initial.clone(), before.clone());
        assert_eq!(result.assets, again.assets);
        assert_eq!(result.references, again.references);
        assert_eq!(after.excess, 0);
        assert_eq!(after.small, 0);
        for r in 0..4 {
          assert_eq!(
            loaded_assets(model, &initial, r),
            loaded_assets(model, &result, r)
          );
          assert!(after.bytes[r] <= before.bytes[r]);
          assert!(after.requests[r] <= before.requests[r]);
          assert!(result.live.contains(r));
        }
        for (b, refs) in result.references.iter().enumerate() {
          if result.live.contains(b) {
            for &r in refs.iter() {
              assert!(result.live.contains(r));
              assert_ne!(r, b);
            }
          }
        }
      },
    );
  }
}

#[test]
fn sparse_live_sets_span_words_and_preserve_asset_dependency_loads() {
  let roots = 70;
  let contents: Vec<Vec<u32>> = (0..74).map(|a| vec![a]).collect();
  let mut references = vec![vec![]; 74];
  for r in 0..roots {
    references[r].push(roots + r % 3);
  }
  check(
    &contents.iter().map(Vec::as_slice).collect::<Vec<_>>(),
    &references.iter().map(Vec::as_slice).collect::<Vec<_>>(),
    roots,
    &[1; 74],
    DefaultBundler {
      min_bundle_size: 2,
      max_parallel_requests: 2,
      ..Default::default()
    },
    |model, initial| {
      // This load follows asset 70 into its new hosts, rather than being an
      // explicit reference on the original shared bundle.
      model.asset_requests[70].push(73);
      model.protected.insert(73);
      model.hosts.set(73, false);
      let before: Vec<_> = (0..roots)
        .map(|r| loaded_assets(model, &initial, r))
        .collect();
      let (result, state) = model.run(initial.clone(), model.state(&initial));
      assert_eq!((state.small, state.excess), (0, 0));
      assert_eq!(result.live.count_ones(..), roots + 1);
      assert!(result.live.contains(73));
      for r in 0..roots {
        assert_eq!(loaded_assets(model, &result, r), before[r]);
      }
      // Evaluating and applying candidates must not mutate their input layout.
      for (b, assets) in initial.assets.iter().enumerate() {
        assert_eq!(assets.as_slice(), [AssetIndex(b as u32)]);
        assert_eq!(initial.references[b].as_slice(), references[b]);
      }
    },
  );
}

#[test]
fn candidate_deltas_match_full_state_with_cycles_diamonds_and_duplicate_assets() {
  let mut seed = 87u32;
  let mut random = || {
    seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
    seed
  };
  for _ in 0..100 {
    let roots = 4;
    let mut contents: Vec<Vec<u32>> = (0..16).map(|b| vec![b * 2, b * 2 + 1]).collect();
    // Some hosts already contain an asset from a shared payload.
    contents[0].push(8 + random() % 24);
    let mut references = vec![vec![]; 16];
    for b in roots..16 {
      references[random() as usize % roots].push(b);
    }
    for b in 0..16 {
      for _ in 0..2 {
        let target = random() as usize % 16;
        if target != b && !references[b].contains(&target) {
          references[b].push(target);
        }
      }
    }
    let sizes: Vec<_> = (0..32).map(|_| random() as usize % 50).collect();
    check(
      &contents.iter().map(Vec::as_slice).collect::<Vec<_>>(),
      &references.iter().map(Vec::as_slice).collect::<Vec<_>>(),
      roots,
      &sizes,
      DefaultBundler {
        min_bundle_size: 60,
        max_parallel_requests: 6,
        ..Default::default()
      },
      |model, initial| {
        for a in 0..32 {
          model.rates[a] = [0.0, 0.1, 1.0][random() as usize % 3];
          if random() % 3 == 0 {
            // Eager asset dependencies target protected loading boundaries.
            model.asset_requests[a].push(random() as usize % roots);
          }
        }
        model.total_rate = model.rates.iter().sum();
        let before: Vec<_> = (0..roots)
          .map(|r| loaded_assets(model, &initial, r))
          .collect();
        let initial_state = model.state(&initial);
        let (result, state) = model.run(initial, initial_state);
        let full = model.state(&result);
        assert_eq!(state.consumers, full.consumers);
        assert_eq!(state.cost, full.cost);
        for r in 0..roots {
          assert_eq!(loaded_assets(model, &result, r), before[r]);
        }
      },
    );
  }
}

#[test]
fn candidate_deltas_preserve_a_diamond_leading_into_a_cycle() {
  check(
    &[&[0], &[1], &[2], &[3], &[4], &[5]],
    &[&[3, 4], &[3, 4], &[], &[], &[5], &[4]],
    3,
    &[100, 100, 100, 1, 100, 100],
    DefaultBundler {
      min_bundle_size: 2,
      ..Default::default()
    },
    |model, initial| {
      model.asset_requests[3].push(4);
      for b in [4, 5] {
        model.protected.insert(b);
        model.hosts.set(b, false);
      }
      let before: Vec<_> = (0..3).map(|r| loaded_assets(model, &initial, r)).collect();
      let initial_state = model.state(&initial);
      let (result, state) = model.run(initial, initial_state);
      assert!(!result.live.contains(3));
      assert_eq!(state.requests, [3, 3, 1]);
      assert_eq!(state.bytes, [301, 301, 100]);
      for r in 0..3 {
        assert_eq!(loaded_assets(model, &result, r), before[r]);
      }
    },
  );
}

#[test]
fn deduplicates_overlapping_payloads_when_already_within_limits() {
  // Bundles 2 and 3 duplicate asset 4 for the same two roots. The layout is
  // already within the limits, so only a cost-reducing move can merge them.
  check(
    &[&[0], &[1], &[2, 4], &[3, 4]],
    &[&[2, 3], &[2, 3], &[], &[]],
    2,
    &[100, 100, 10, 10, 100],
    DefaultBundler {
      min_bundle_size: 0,
      max_parallel_requests: 0,
      ..Default::default()
    },
    |model, initial| {
      let before: Vec<_> = (0..2).map(|r| loaded_assets(model, &initial, r)).collect();
      let state = model.state(&initial);
      assert!(state.within_limits());
      let (result, after) = model.run(initial.clone(), state.clone());
      // The shared asset is downloaded once per root instead of twice.
      assert!(!result.live.contains(2));
      assert_eq!(
        result.assets[3].as_slice(),
        [AssetIndex(3), AssetIndex(4), AssetIndex(2)]
      );
      assert_eq!(after.requests, [2, 2]);
      assert_eq!(after.bytes, [220, 220]);
      assert!(after.cost < state.cost);
      for r in 0..2 {
        assert_eq!(loaded_assets(model, &result, r), before[r]);
      }
    },
  );
}

#[test]
fn leaves_disjoint_payloads_alone_when_within_limits() {
  // The same shape without an overlapping asset: merging would enlarge the
  // edit invalidation cost without saving any bytes, so no move is taken.
  check(
    &[&[0], &[1], &[2], &[3]],
    &[&[2, 3], &[2, 3], &[], &[]],
    2,
    &[100, 100, 10, 10],
    DefaultBundler {
      min_bundle_size: 0,
      max_parallel_requests: 0,
      ..Default::default()
    },
    |model, initial| {
      let state = model.state(&initial);
      let (result, after) = model.run(initial.clone(), state.clone());
      assert_eq!(result.assets, initial.assets);
      assert_eq!(result.references, initial.references);
      assert_eq!(result.live, initial.live);
      assert_eq!(after.cost, state.cost);
    },
  );
}

#[test]
fn composes_relief_and_deduplication_in_one_search() {
  // Bundle 4 is undersized and bundles 2 and 3 duplicate asset 4. One pass
  // repairs the size violation and merges the duplicated payload, whichever
  // move scores better first, ending with one copy of asset 4 per root.
  check(
    &[&[0], &[1], &[2, 4], &[3, 4], &[5]],
    &[&[2, 3, 4], &[2, 3, 4], &[], &[], &[]],
    2,
    &[100, 100, 20, 20, 200, 5],
    DefaultBundler {
      min_bundle_size: 10,
      max_parallel_requests: 0,
      ..Default::default()
    },
    |model, initial| {
      let before: Vec<_> = (0..2).map(|r| loaded_assets(model, &initial, r)).collect();
      let state = model.state(&initial);
      assert_eq!(state.small, 2);
      let (result, after) = model.run(initial, state.clone());
      assert!(after.within_limits());
      assert!(after.cost < state.cost);
      assert_eq!(after.requests, [2, 2]);
      assert_eq!(after.bytes, [345, 345]);
      for r in 0..2 {
        assert_eq!(loaded_assets(model, &result, r), before[r]);
      }
    },
  );
}

#[test]
fn protected_roots_donate_copies_to_relieve_request_pressure() {
  // Bundle 1 is a lazy root whose payload is also required by root 2, like a
  // reused bundle. Under request pressure its payload is copied into root 2,
  // while the original stays live and untouched for its own loading boundary.
  check(
    &[&[0], &[1, 2, 3], &[4]],
    &[&[], &[], &[1]],
    3,
    &[100, 50, 30, 20, 100],
    DefaultBundler {
      min_bundle_size: 0,
      max_parallel_requests: 1,
      compression: Compression::None,
      ..Default::default()
    },
    |model, initial| {
      let before: Vec<_> = (0..3).map(|r| loaded_assets(model, &initial, r)).collect();
      let state = model.state(&initial);
      assert_eq!(state.excess, 1);
      let (result, after) = model.run(initial, state);
      assert!(result.live.is_full());
      assert_eq!(
        result.assets[1].as_slice(),
        [AssetIndex(1), AssetIndex(2), AssetIndex(3)]
      );
      assert_eq!(
        result.assets[2].as_slice(),
        [AssetIndex(4), AssetIndex(1), AssetIndex(2), AssetIndex(3)]
      );
      assert!(result.references[2].is_empty());
      assert_eq!(after.requests, [1, 1, 1]);
      assert_eq!((after.small, after.excess), (0, 0));
      for r in 0..3 {
        assert_eq!(loaded_assets(model, &result, r), before[r]);
      }
    },
  );
}

#[test]
fn compression_consolidates_small_bundles_until_invalidation_outweighs_savings() {
  // With a concave wire curve, merging two disjoint 6KB payloads saves the
  // warmup bytes past the knee. At 200KB the flat per-merge saving no longer
  // pays for the larger invalidation blast radius, and with no compression
  // the curve is linear, so both leave the layout alone.
  for (compression, size, merges) in [
    (Compression::Brotli, 6_000, true),
    (Compression::Brotli, 200_000, false),
    (Compression::None, 6_000, false),
  ] {
    check(
      &[&[0], &[1], &[2], &[3]],
      &[&[2, 3], &[2, 3], &[], &[]],
      2,
      &[10_000, 10_000, size, size],
      DefaultBundler {
        min_bundle_size: 0,
        max_parallel_requests: 0,
        compression,
        ..Default::default()
      },
      |model, initial| {
        // Restrict hosts to the shared bundles to isolate the merge decision.
        model.hosts.set(0, false);
        model.hosts.set(1, false);
        let state = model.state(&initial);
        let (result, after) = model.run(initial.clone(), state.clone());
        if merges {
          assert_eq!(result.live.count_ones(..), 3);
          assert!(after.cost < state.cost);
          assert_eq!(after.requests, [2, 2]);
          assert_eq!(after.bytes, state.bytes);
        } else {
          assert_eq!(result.assets, initial.assets);
          assert_eq!(result.references, initial.references);
        }
      },
    );
  }
}

/// Run with `cargo test -p parcel --release --lib optimizer_workload_timings -- --ignored --nocapture`.
#[test]
#[ignore = "manual optimizer timing comparison"]
fn optimizer_workload_timings() {
  for (name, roots, shared, assets_per_bundle) in [
    ("small graph", 4, 4, 4),
    ("many assets", 8, 16, 128),
    ("many roots", 32, 32, 4),
    ("few affected roots", 128, 32, 4),
    ("broadly shared", 32, 16, 4),
    ("already within limits", 16, 16, 16),
  ] {
    let contents: Vec<Vec<u32>> = (0..roots + shared)
      .map(|b| {
        (b * assets_per_bundle..(b + 1) * assets_per_bundle)
          .map(|a| a as u32)
          .collect()
      })
      .collect();
    let mut references = vec![vec![]; roots + shared];
    for b in roots..roots + shared {
      for r in 0..roots {
        let includes = match name {
          "few affected roots" => r % shared == b % shared,
          "broadly shared" => true,
          _ => r % 4 == b % 4 || r % 4 == (b + 1) % 4,
        };
        if includes {
          references[r].push(b);
        }
      }
    }
    check(
      &contents.iter().map(Vec::as_slice).collect::<Vec<_>>(),
      &references.iter().map(Vec::as_slice).collect::<Vec<_>>(),
      roots,
      &vec![1; (roots + shared) * assets_per_bundle],
      DefaultBundler {
        min_bundle_size: if name == "already within limits" {
          0
        } else {
          assets_per_bundle + 1
        },
        max_parallel_requests: 25,
        ..Default::default()
      },
      |model, initial| {
        model.check_deltas = false;
        let mut times = Vec::new();
        for _ in 0..5 {
          let start = std::time::Instant::now();
          let state = model.state(&initial);
          std::hint::black_box(model.run(initial.clone(), state));
          times.push(start.elapsed());
        }
        times.sort();
        eprintln!("{name}: median {:?}", times[times.len() / 2]);
      },
    );
  }
}

// Check every candidate against the full calculation, including candidates
// rejected early. Timing tests disable this oracle so they measure real work.
pub(super) fn assert_candidate(
  search: &Search,
  source: usize,
  hosts: &[usize],
  assessment: &Assessment,
) {
  let model = search.model;
  let before = &search.state;
  let mut layout = search.layout.clone();
  let mut members = FixedBitSet::with_capacity(model.sizes.len());
  apply(
    &mut layout,
    &mut members,
    source,
    hosts,
    &assessment.redirects,
    assessment.alive,
  );
  let full = model.state(&layout);
  let improved = full.small + full.excess < before.small + before.excess
    || full.cost < before.cost - COST_EPSILON;
  let valid = full
    .consumers
    .iter()
    .zip(&before.consumers)
    .all(|(a, b)| a.is_subset(b))
    && full.bytes.iter().zip(&before.bytes).all(|(a, b)| a <= b)
    && full
      .requests
      .iter()
      .zip(&before.requests)
      .all(|(a, b)| a <= b)
    && full.requests.iter().sum::<usize>() < before.requests.iter().sum::<usize>()
    && full.small <= before.small
    && full.excess <= before.excess
    && improved;
  assert_eq!(
    assessment.accepted.is_some(),
    valid,
    "candidate acceptance differs from full state (source {source}, hosts {hosts:?})"
  );
  let Some(verdict) = &assessment.accepted else {
    return;
  };
  assert_eq!((verdict.small, verdict.excess), (full.small, full.excess));
  assert!(
    (verdict.cost - full.cost).abs() <= 1e-9 * full.cost.abs().max(1.0),
    "predicted cost {} differs from full state {}",
    verdict.cost,
    full.cost
  );
}
