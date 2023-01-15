use criterion::{black_box, criterion_group, criterion_main, Criterion};

use parcel_resolver::glob::*;

const EXT: &'static str = "some/a/bigger/path/to/the/crazy/needle.txt";
const EXT_PAT: &'static str = "**/*.txt";

const SHORT: &'static str = "some/needle.txt";
const SHORT_PAT: &'static str = "some/**/needle.txt";

const LONG: &'static str = "some/a/bigger/path/to/the/crazy/needle.txt";
const LONG_PAT: &'static str = "some/**/needle.txt";

#[inline]
fn glob(pat: &str, s: &str) -> bool {
  let pat = glob::Pattern::new(pat).unwrap();
  pat.matches(s)
}

#[inline]
fn globset(pat: &str, s: &str) -> bool {
  let pat = globset::Glob::new(pat).unwrap().compile_matcher();
  pat.is_match(s)
}

fn mine(b: &mut Criterion) {
  b.bench_function("mine", |b| b.iter(|| assert!(glob_match(EXT_PAT, EXT))));
}

fn glob_crate(b: &mut Criterion) {
  b.bench_function("glob_crate", |b| b.iter(|| assert!(glob(EXT_PAT, EXT))));
}

fn globset_crate(b: &mut Criterion) {
  b.bench_function("globset_crate", |b| {
    b.iter(|| assert!(globset(EXT_PAT, EXT)))
  });
}

criterion_group!(benches, globset_crate, glob_crate, mine);
criterion_main!(benches);
