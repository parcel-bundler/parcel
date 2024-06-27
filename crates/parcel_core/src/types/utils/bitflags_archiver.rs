use std::marker::PhantomData;

use bitflags::Flags;
use rkyv::primitive::ArchivedU16;
use rkyv::rancor::Fallible;
use rkyv::rend::u16_le;
use rkyv::with::{ArchiveWith, DeserializeWith, SerializeWith};
use rkyv::{Archive, Serialize};

/// Implements bitflags archival using rkyv
///
/// Bitflags are 'serialized' into u16 little-endian values. This is just boilerplate to adapt to
/// the bitflags crate and is essentially free.
pub(crate) struct BitFlagsArchiver<T: Flags<Bits = u16>> {
  _phantom: PhantomData<T>,
}

impl<T: Flags<Bits = u16>> ArchiveWith<T> for BitFlagsArchiver<T> {
  type Archived = ArchivedU16;
  type Resolver = ();

  #[inline]
  unsafe fn resolve_with(
    field: &T,
    pos: usize,
    resolver: Self::Resolver,
    out: *mut Self::Archived,
  ) {
    let le_value = u16_le::from_native(field.bits());
    ArchivedU16::resolve(&le_value, pos, resolver, out);
  }
}

impl<T: Flags<Bits = u16>, S: Fallible + ?Sized> SerializeWith<T, S> for BitFlagsArchiver<T> {
  #[inline]
  fn serialize_with(field: &T, serializer: &mut S) -> Result<Self::Resolver, S::Error> {
    let le_value = u16_le::from_native(field.bits());
    ArchivedU16::serialize(&le_value, serializer)
  }
}

impl<T: Flags<Bits = u16>, D: Fallible + ?Sized> DeserializeWith<ArchivedU16, T, D>
  for BitFlagsArchiver<T>
{
  #[inline]
  fn deserialize_with(field: &ArchivedU16, _: &mut D) -> Result<T, D::Error> {
    Ok(T::from_bits(field.to_native()).unwrap())
  }
}

#[cfg(test)]
mod test {
  use bitflags::bitflags;
  use rkyv::rancor::Failure;

  use super::*;

  bitflags! {
    #[derive(Debug, Eq, PartialEq, Copy, Clone, Hash)]
    pub struct TestFlags: u16 {
      const CASE_ONE = 1 << 0;
      const CASE_TWO = 1 << 1;
    }
  }

  #[derive(rkyv::Serialize, rkyv::Deserialize, rkyv::Archive)]
  #[archive(check_bytes)]
  struct Holder {
    #[with(BitFlagsArchiver<TestFlags>)]
    value: TestFlags,
  }

  #[test]
  fn test_archival_of_bitflags() {
    let mut flags = TestFlags::empty();
    assert!(flags.is_empty());
    flags.set(TestFlags::CASE_ONE, true);

    let holder = Holder { value: flags };
    let bytes = rkyv::to_bytes::<_, 256, anyhow::Error>(&holder).unwrap();
    let Holder { value } = rkyv::from_bytes::<Holder, Failure>(&bytes).unwrap();
    assert!(!value.is_empty());
    assert_eq!(value, TestFlags::CASE_ONE);
  }
}
