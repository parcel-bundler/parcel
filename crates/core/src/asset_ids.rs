use rustc_hash::FxHashMap;

use crate::AssetIndex;

/// The shortest id an asset gets.
const MIN_LEN: u8 = 4;
/// Enough base62 digits for any `u64`, so two distinct hashes always differ by this length.
const MAX_LEN: u8 = 11;

pub(super) const ALPHABET: &[u8; 62] =
  b"0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const PREFIX_SPACE: u64 = 62u64.pow(4);

// Two base62 digits in output order.
static PAIRS: [[u8; 2]; 62 * 62] = {
  let mut pairs = [[0; 2]; 62 * 62];
  let mut i = 0;
  while i < pairs.len() {
    pairs[i] = [ALPHABET[i % 62], ALPHABET[i / 62]];
    i += 1;
  }
  pairs
};

/// Each asset's id in packaged output: a short base62 prefix (least significant digit first) of
/// its stable hash (`Asset::id_u64`), which every reference to the asset repeats.
#[derive(Debug, Clone, Default)]
pub struct AssetIds {
  /// Every id, concatenated.
  strings: String,
  /// Each asset's id within `strings`, by asset index.
  end: Vec<usize>,
}

impl AssetIds {
  /// The number of assets with an id. Assets are indexed in the order they were added.
  pub fn len(&self) -> usize {
    self.end.len()
  }

  pub fn is_empty(&self) -> bool {
    self.end.is_empty()
  }

  /// The id of an asset, which must have one.
  pub fn get(&self, asset: AssetIndex) -> &str {
    let start = if asset.index() > 0 {
      self.end[asset.index() - 1]
    } else {
      0
    };
    let end = self.end[asset.index()];
    &self.strings[start..end]
  }

  pub fn assign_short(&mut self, hashes: Vec<u64>) {
    let (strings, end) = short_ids(&hashes);
    self.strings = strings;
    self.end = end;
  }

  /// Assigns full ids to the next assets. Only used in development.
  pub fn extend(&mut self, hashes: Vec<u64>) {
    if hashes.is_empty() {
      return;
    }

    self.strings.reserve(hashes.len() * MAX_LEN as usize);
    for hash in hashes {
      let encoded = full_id(hash);
      // SAFETY: alphabet is ascii.
      self
        .strings
        .push_str(unsafe { std::str::from_utf8_unchecked(&encoded) });
      self.end.push(self.strings.len());
    }
  }
}

/// Encodes an id as eleven ASCII base62 digits, least significant digit first.
fn full_id(mut id: u64) -> [u8; MAX_LEN as usize] {
  std::array::from_fn(|_| {
    let digit = ALPHABET[(id % 62) as usize];
    id /= 62;
    digit
  })
}

/// The shortest distinguishing little-endian base62 prefix of each id, with a minimum of four
/// digits. Equal ids get the same prefix. The ranges are in input order, and adding an id
/// only lengthens existing ids that share its prefix.
fn short_ids(ids: &[u64]) -> (String, Vec<usize>) {
  let mut candidates = collision_candidates(&ids);
  let extra = extend_prefixes(&mut candidates);
  let mut strings = Vec::with_capacity(4 * ids.len() + extra);
  let mut end = Vec::with_capacity(ids.len());
  // Write the fixed-width part in runs, then append the extra digits at each collision.
  let mut start = 0;
  for Candidate { index, len, .. } in candidates {
    if len == MIN_LEN {
      continue;
    }
    append_prefixes(&ids[start..=index], &mut strings, &mut end);
    let mut suffix = ids[index] / PREFIX_SPACE;
    for _ in MIN_LEN..len {
      strings.push(ALPHABET[(suffix % 62) as usize]);
      suffix /= 62;
    }
    end[index] = strings.len();
    start = index + 1;
  }
  append_prefixes(&ids[start..], &mut strings, &mut end);
  (
    // SAFETY: The alphabet is ASCII.
    unsafe { String::from_utf8_unchecked(strings) },
    end,
  )
}

fn prefix_bytes(id: u64) -> [u8; 4] {
  let prefix = (id % PREFIX_SPACE) as usize;
  let [a, b] = PAIRS[prefix % (62 * 62)];
  let [c, d] = PAIRS[prefix / (62 * 62)];
  [a, b, c, d]
}

fn append_prefixes(ids: &[u64], strings: &mut Vec<u8>, end: &mut Vec<usize>) {
  let start = strings.len();
  end.extend((0..ids.len()).map(|i| start + 4 * i + 4));
  strings.extend(ids.iter().flat_map(|&id| prefix_bytes(id)));
}

struct Candidate {
  index: usize,
  prefix: u64,
  suffix: u64,
  len: u8,
}

fn collision_candidates(ids: &[u64]) -> Vec<Candidate> {
  // Fold the four-digit prefix space into a smaller bitmap for small graphs. Unrelated prefixes
  // can land in the same bucket, but only a bucket hit needs an exact comparison.
  let words = ids
    .len()
    .min((PREFIX_SPACE as usize).div_ceil(64))
    .next_power_of_two();
  let mut bits = vec![0u64; 2 * words];
  let (seen, repeated) = bits.split_at_mut(words);
  let bucket = |id: u64| {
    let prefix = (id % PREFIX_SPACE) as usize;
    ((prefix >> 6) & (words - 1), 1u64 << (prefix & 63))
  };
  let mut hits = 0;
  for &id in ids {
    let (word, bit) = bucket(id);
    if seen[word] & bit != 0 {
      repeated[word] |= bit;
      hits += 1;
    }
    seen[word] |= bit;
  }

  if hits == 0 {
    return Vec::new();
  }
  // Each hit accounts for itself and at most one earlier id in its bucket.
  let mut candidates = Vec::with_capacity((2 * hits).min(ids.len()));
  for (index, &id) in ids.iter().enumerate() {
    let (word, bit) = bucket(id);
    if repeated[word] & bit != 0 {
      candidates.push(Candidate {
        index,
        prefix: id % PREFIX_SPACE,
        suffix: id / PREFIX_SPACE,
        len: 4,
      });
    }
  }
  candidates
}

// Check one more digit only for prefixes shared by distinct ids. A representative suffix
// always fits in fewer than 64 bits once the first four digits have been stripped.
fn extend_prefixes(candidates: &mut [Candidate]) -> usize {
  const AMBIGUOUS: u64 = u64::MAX;
  let mut witnesses = FxHashMap::with_capacity_and_hasher(candidates.len(), Default::default());
  let mut extra = 0;
  for len in MIN_LEN..MAX_LEN {
    witnesses.clear();
    for candidate in candidates.iter().filter(|c| c.len == len) {
      let witness = witnesses
        .entry(candidate.prefix)
        .or_insert(candidate.suffix);
      if *witness != candidate.suffix {
        *witness = AMBIGUOUS;
      }
    }
    let mut extended = 0;
    for candidate in candidates.iter_mut().filter(|c| c.len == len) {
      if witnesses[&candidate.prefix] == AMBIGUOUS {
        candidate.len += 1;
        if candidate.len < MAX_LEN {
          candidate.prefix = candidate.prefix * 62 + candidate.suffix % 62;
          candidate.suffix /= 62;
        }
        extended += 1;
      }
    }
    if extended == 0 {
      break;
    }
    extra += extended;
  }
  extra
}

#[cfg(test)]
mod test {
  use super::{full_id, short_ids};

  #[test]
  fn short_ids_match_pairwise_prefix_comparison() {
    const ALPHABET: &[u8; 62] = b"0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    let mut ids = vec![0, u64::MAX, 0, u64::MAX, 1, 1 + (1 << 18)];
    // Force every possible distinguishing length, including eleven digits, with
    // duplicates on both sides of the collision and zero padding at the high end.
    for len in 4..=10 {
      let step = 62u64.pow(len);
      ids.extend([step, u64::MAX - step, step, u64::MAX - step]);
    }
    for i in 0..128u64 {
      let hash = xxhash_rust::xxh3::xxh3_64(&i.to_le_bytes());
      ids.push(hash);
      ids.push(hash / 62u64.pow(6) * 62u64.pow(6));
    }

    let encoded: Vec<String> = ids
      .iter()
      .copied()
      .map(|mut id| {
        (0..11)
          .map(|_| {
            let digit = ALPHABET[(id % 62) as usize];
            id /= 62;
            char::from(digit)
          })
          .collect()
      })
      .collect();

    for (&id, expected) in ids.iter().zip(&encoded) {
      assert_eq!(full_id(id).as_slice(), expected.as_bytes());
    }

    for size in [0, 1, 2, 6, ids.len()] {
      let (strings, end) = short_ids(&ids[..size]);
      assert_eq!(end.len(), size);
      let mut offset = 0;
      for (id, end) in encoded[..size].iter().zip(&end) {
        let len = (4..=11)
          .find(|&len| {
            encoded[..size]
              .iter()
              .all(|other| other == id || other[..len] != id[..len])
          })
          .unwrap();
        assert_eq!(*end, offset + len);
        assert_eq!(&strings[offset..*end], &id[..len]);
        offset += len;
      }
      assert_eq!(strings.len(), offset);
    }
  }

  #[test]
  fn short_ids_extend_shared_prefixes() {
    let base = 5 + 7 * 62 + 11 * 62u64.pow(2) + 13 * 62u64.pow(3);
    let ids = [
      base,
      // Shares 4 digits with `base`.
      base + 62u64.pow(4),
      // Shares 5 digits with `base`.
      base + 62u64.pow(5),
      1,
      // A duplicate asset.
      1,
    ];
    let (string, end) = short_ids(&ids);
    let mut offset = 0;
    let short: Vec<&str> = end
      .into_iter()
      .map(|end| {
        let res = &string[offset..end];
        offset = end;
        res
      })
      .collect();
    assert_eq!(short, ["57bd00", "57bd1", "57bd01", "1000", "1000"]);
  }

  #[test]
  fn short_ids_dont_depend_on_order() {
    let ids: Vec<u64> = (0..2000u64)
      .map(|i| i.wrapping_mul(0x9e3779b97f4a7c15) % 62u64.pow(5))
      .collect();
    let (string, end) = short_ids(&ids);
    let mut offset = 0;
    let short: Vec<&str> = end
      .into_iter()
      .map(|end| {
        let res = &string[offset..end];
        offset = end;
        res
      })
      .collect();
    let reversed: Vec<u64> = ids.iter().rev().copied().collect();
    let (string, end) = short_ids(&reversed);
    let mut offset = 0;
    let mut reversed_short: Vec<&str> = end
      .into_iter()
      .map(|end| {
        let res = &string[offset..end];
        offset = end;
        res
      })
      .collect();
    reversed_short.reverse();
    assert_eq!(short, reversed_short);
    let unique: std::collections::HashSet<_> = short.iter().collect();
    assert_eq!(unique.len(), ids.len());
  }
}
