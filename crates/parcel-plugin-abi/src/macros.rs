//! Internal helpers for keeping the stable ABI synchronized with Parcel core.

/// Verifies that mirrored Parcel core and ABI bitflags use the same bit values.
///
/// ABI values remain explicit in their public declarations so cbindgen can see
/// them and so changes to the compatibility contract are always intentional.
macro_rules! assert_flag_values {
  (
    core = $core:ty,
    abi = $abi:ty,
    repr = $repr:ty;
    flags = {
      $( $core_flag:ident => $abi_flag:ident ),+ $(,)?
    }
    $( ignored = [ $( $ignored_flag:ident ),* $(,)? ]; )?
  ) => {
    $(
      const _: () = assert!(
        <$core>::$core_flag.bits() == <$abi>::$abi_flag as $repr,
        concat!("Parcel core and ABI flag values differ for ", stringify!($core_flag)),
      );
    )+

    const _: () = assert!(
      <$core>::all().bits()
        == (0 $(| <$core>::$core_flag.bits())+ $( $(| <$core>::$ignored_flag.bits())* )?),
      "Parcel core flag inventory changed; map or explicitly ignore the new flags",
    );
  };
}

/// Implements exhaustive conversions between a Parcel core enum and its ABI enum.
///
/// Adding a core variant makes the generated `match` non-exhaustive, forcing an
/// intentional decision about how the new variant should be represented in the ABI.
macro_rules! impl_enum_conversion {
  (
    $core:ty => $abi:ty {
      $( $core_variant:path => $abi_variant:path ),+ $(,)?
    }
  ) => {
    impl From<$core> for $abi {
      fn from(value: $core) -> Self {
        match value {
          $( $core_variant => $abi_variant ),+
        }
      }
    }

    impl From<$abi> for $core {
      fn from(value: $abi) -> Self {
        match value {
          $( $abi_variant => $core_variant ),+
        }
      }
    }
  };
}
