use std::error::Error;
use std::marker::PhantomData;

use bitflags::Flags;
use rkyv::primitive::ArchivedU16;
use rkyv::rancor::Fallible;
use rkyv::rend::u16_le;
use rkyv::with::{ArchiveWith, DeserializeWith, SerializeWith};
use rkyv::{Archive, Serialize, SerializeUnsized};

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

impl<T: Flags<Bits = u16>, S: Fallible + ?Sized> SerializeWith<T, S> for BitFlagsArchiver<T>
where
  S::Error: Error,
  str: SerializeUnsized<S>,
{
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
