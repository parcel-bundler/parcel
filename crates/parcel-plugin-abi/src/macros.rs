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
    $core:ty => $abi:ident {
      $( $core_variant:path => $_abi:ident :: $abi_variant:ident ),+ $(,)?
    }
  ) => {
    impl From<$core> for $abi {
      fn from(value: $core) -> Self {
        match value {
          $( $core_variant => $abi::$abi_variant ),+
        }
      }
    }

    impl From<$abi> for $core {
      fn from(value: $abi) -> Self {
        match value {
          $( $abi::$abi_variant => $core_variant ),+
        }
      }
    }

    impl_raw_enum!($abi { $( $abi_variant ),+ });
  };
}

/// Implements `TryFrom<u8>` for an ABI enum, for reading a value a plugin
/// supplied.
///
/// A plugin hands Parcel enums as raw bytes, and one built against a newer SDK
/// can send a variant this build has never heard of. Reading such a byte as the
/// Rust enum would be undefined behavior, so every enum Parcel receives is
/// declared as its `*FFI` integer alias instead and converted here, leaving each
/// call site to decide whether an unknown value is an error or falls back to a
/// default. Enums Parcel only ever sends can stay typed: it never produces a
/// value it does not know.
///
/// The variant list must be exhaustive, which the generated `match` enforces.
macro_rules! impl_raw_enum {
  ($abi:ident { $( $variant:ident ),+ $(,)? }) => {
    impl TryFrom<u8> for $abi {
      type Error = u8;

      fn try_from(value: u8) -> Result<Self, u8> {
        // Exhaustiveness check only; never called.
        const _: fn($abi) = |value| match value {
          $( $abi::$variant => {} ),+
        };

        $( if value == $abi::$variant as u8 {
          return Ok($abi::$variant);
        } )+
        Err(value)
      }
    }
  };
}
