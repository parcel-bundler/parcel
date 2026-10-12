//! Trust on macOS: the CA is added to the login keychain and trusted in the user's trust settings,
//! which Safari, Chrome, and Firefox all read. Changing trust settings shows the system's password
//! dialog. Without a GUI to show it in, e.g. over SSH, the CA is trusted for all users with sudo
//! instead.

use std::{ffi::c_void, io::IsTerminal, path::Path, process::Command};

use parcel_core::{LogLevel, ParcelOptions};

use super::{Outcome, StoreResult};
use crate::{
  cert::LocalCa,
  macos::{CFTypeRef, Owned, string, to_string},
};

/// Shown before installing. The system's password dialog asks for consent.
pub const CONFIRM: bool = false;

const ERR_SEC_SUCCESS: i32 = 0;
const ERR_SEC_ITEM_NOT_FOUND: i32 = -25300;
const ERR_SEC_DUPLICATE_ITEM: i32 = -25299;
const ERR_AUTHORIZATION_CANCELED: i32 = -60006;
const ERR_AUTHORIZATION_INTERACTION_NOT_ALLOWED: i32 = -60007;
const K_SEC_TRUST_SETTINGS_DOMAIN_USER: u32 = 0;
const K_SEC_TRUST_SETTINGS_DOMAIN_ADMIN: u32 = 1;

const SYSTEM_KEYCHAIN: &str = "/Library/Keychains/System.keychain";

#[repr(C)]
struct CFDictionaryCallBacks {
  _private: [u8; 0],
}

#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
  static kCFTypeDictionaryKeyCallBacks: CFDictionaryCallBacks;
  static kCFTypeDictionaryValueCallBacks: CFDictionaryCallBacks;
  static kCFBooleanTrue: CFTypeRef;
  fn CFDataCreate(allocator: CFTypeRef, bytes: *const u8, length: isize) -> CFTypeRef;
  fn CFDataGetBytePtr(data: CFTypeRef) -> *const u8;
  fn CFDataGetLength(data: CFTypeRef) -> isize;
  fn CFArrayGetCount(array: CFTypeRef) -> isize;
  fn CFArrayGetValueAtIndex(array: CFTypeRef, index: isize) -> CFTypeRef;
  fn CFDictionaryCreate(
    allocator: CFTypeRef,
    keys: *const CFTypeRef,
    values: *const CFTypeRef,
    count: isize,
    key_callbacks: *const CFDictionaryCallBacks,
    value_callbacks: *const CFDictionaryCallBacks,
  ) -> CFTypeRef;
}

#[link(name = "Security", kind = "framework")]
unsafe extern "C" {
  static kSecClass: CFTypeRef;
  static kSecClassCertificate: CFTypeRef;
  static kSecValueRef: CFTypeRef;
  static kSecAttrLabel: CFTypeRef;
  static kSecMatchLimit: CFTypeRef;
  static kSecMatchLimitAll: CFTypeRef;
  static kSecReturnRef: CFTypeRef;
  fn SecItemCopyMatching(query: CFTypeRef, result: *mut CFTypeRef) -> i32;
  fn SecCertificateCopyData(certificate: CFTypeRef) -> CFTypeRef;
  fn SecCertificateCreateWithData(allocator: CFTypeRef, data: CFTypeRef) -> CFTypeRef;
  fn SecPolicyCreateSSL(server: u8, hostname: CFTypeRef) -> CFTypeRef;
  fn SecTrustCreateWithCertificates(
    certificates: CFTypeRef,
    policies: CFTypeRef,
    trust: *mut CFTypeRef,
  ) -> i32;
  fn SecTrustSetNetworkFetchAllowed(trust: CFTypeRef, allow: u8) -> i32;
  fn SecTrustEvaluateWithError(trust: CFTypeRef, error: *mut CFTypeRef) -> bool;
  fn SecItemAdd(attributes: CFTypeRef, result: *mut CFTypeRef) -> i32;
  fn SecItemDelete(query: CFTypeRef) -> i32;
  fn SecTrustSettingsCopyTrustSettings(
    certificate: CFTypeRef,
    domain: u32,
    settings: *mut CFTypeRef,
  ) -> i32;
  fn SecTrustSettingsSetTrustSettings(
    certificate: CFTypeRef,
    domain: u32,
    settings: CFTypeRef,
  ) -> i32;
  fn SecTrustSettingsRemoveTrustSettings(certificate: CFTypeRef, domain: u32) -> i32;
  fn SecCopyErrorMessageString(status: i32, reserved: *mut c_void) -> CFTypeRef;
}

fn certificate(der: &[u8]) -> Option<Owned> {
  let data =
    Owned::new(unsafe { CFDataCreate(std::ptr::null(), der.as_ptr(), der.len() as isize) })?;
  Owned::new(unsafe { SecCertificateCreateWithData(std::ptr::null(), data.0) })
}

/// A keychain query or item matching `certificate`.
fn certificate_item(certificate: &Owned) -> Option<Owned> {
  let keys = unsafe { [kSecClass, kSecValueRef] };
  let values = [unsafe { kSecClassCertificate }, certificate.0];
  Owned::new(unsafe {
    CFDictionaryCreate(
      std::ptr::null(),
      keys.as_ptr(),
      values.as_ptr(),
      keys.len() as isize,
      &kCFTypeDictionaryKeyCallBacks,
      &kCFTypeDictionaryValueCallBacks,
    )
  })
}

/// Deletes the keychain's copies of the certificate `der`. They must be found first: a reference
/// to a certificate created from its data doesn't match one in a keychain.
fn delete_from_keychain(der: &[u8]) -> Outcome {
  let Some(label) = string(crate::cert::CA_NAME) else {
    return Outcome::Failed("Could not create a keychain query".to_string());
  };
  let keys = unsafe { [kSecClass, kSecAttrLabel, kSecMatchLimit, kSecReturnRef] };
  let values = unsafe {
    [
      kSecClassCertificate,
      label.0,
      kSecMatchLimitAll,
      kCFBooleanTrue,
    ]
  };
  let Some(query) = Owned::new(unsafe {
    CFDictionaryCreate(
      std::ptr::null(),
      keys.as_ptr(),
      values.as_ptr(),
      keys.len() as isize,
      &kCFTypeDictionaryKeyCallBacks,
      &kCFTypeDictionaryValueCallBacks,
    )
  }) else {
    return Outcome::Failed("Could not create a keychain query".to_string());
  };
  let mut found = std::ptr::null();
  match unsafe { SecItemCopyMatching(query.0, &mut found) } {
    ERR_SEC_SUCCESS => {}
    ERR_SEC_ITEM_NOT_FOUND => return Outcome::Unchanged,
    status => return Outcome::Failed(error_message(status)),
  }
  let Some(found) = Owned::new(found) else {
    return Outcome::Unchanged;
  };

  let mut outcome = Outcome::Unchanged;
  for i in 0..unsafe { CFArrayGetCount(found.0) } {
    let certificate = unsafe { CFArrayGetValueAtIndex(found.0, i) };
    let Some(data) = Owned::new(unsafe { SecCertificateCopyData(certificate) }) else {
      continue;
    };
    let bytes = unsafe {
      std::slice::from_raw_parts(CFDataGetBytePtr(data.0), CFDataGetLength(data.0) as usize)
    };
    if bytes != der {
      continue;
    }
    let keys = unsafe { [kSecClass, kSecValueRef] };
    let values = [unsafe { kSecClassCertificate }, certificate];
    let Some(item) = Owned::new(unsafe {
      CFDictionaryCreate(
        std::ptr::null(),
        keys.as_ptr(),
        values.as_ptr(),
        keys.len() as isize,
        &kCFTypeDictionaryKeyCallBacks,
        &kCFTypeDictionaryValueCallBacks,
      )
    }) else {
      continue;
    };
    match unsafe { SecItemDelete(item.0) } {
      ERR_SEC_SUCCESS => outcome = Outcome::Done,
      status => return Outcome::Failed(error_message(status)),
    }
  }
  outcome
}

fn error_message(status: i32) -> String {
  let message = unsafe { SecCopyErrorMessageString(status, std::ptr::null_mut()) };
  Owned::new(message)
    .and_then(|message| to_string(message.0))
    .unwrap_or_else(|| format!("error {status}"))
}

fn has_trust_settings(certificate: &Owned, domain: u32) -> bool {
  let mut settings = std::ptr::null();
  let status = unsafe { SecTrustSettingsCopyTrustSettings(certificate.0, domain, &mut settings) };
  drop(Owned::new(settings));
  status == ERR_SEC_SUCCESS
}

/// Whether the system trusts certificates the CA signs for TLS servers, however it came to.
pub fn is_trusted(ca: &LocalCa) -> bool {
  let Some(leaf) = ca.localhost_der().and_then(|der| certificate(&der)) else {
    return false;
  };
  let Some(hostname) = string("localhost") else {
    return false;
  };
  let Some(policy) = Owned::new(unsafe { SecPolicyCreateSSL(1, hostname.0) }) else {
    return false;
  };
  let mut trust = std::ptr::null();
  if unsafe { SecTrustCreateWithCertificates(leaf.0, policy.0, &mut trust) } != ERR_SEC_SUCCESS {
    return false;
  }
  let Some(trust) = Owned::new(trust) else {
    return false;
  };
  unsafe { SecTrustSetNetworkFetchAllowed(trust.0, 0) };
  let mut error = std::ptr::null();
  let trusted = unsafe { SecTrustEvaluateWithError(trust.0, &mut error) };
  drop(Owned::new(error));
  trusted
}

pub fn explanation(_ca: &LocalCa, _ca_path: &Path) -> String {
  "To make browsers trust it, Parcel will add it to your login keychain. macOS will ask for your \
   password."
    .to_string()
}

pub fn install(ca: &LocalCa, ca_path: &Path, options: &ParcelOptions) -> Vec<StoreResult> {
  let result = |outcome| {
    vec![StoreResult {
      store: "login keychain".to_string(),
      outcome,
    }]
  };
  if is_trusted(ca) {
    return result(Outcome::Unchanged);
  }
  let Some(certificate) = certificate(&ca.cert_der()) else {
    return result(Outcome::Failed("Invalid certificate".to_string()));
  };

  // Trust settings are kept apart from certificates, so the CA must also be in a keychain for
  // macOS to find it when verifying the certificates it signs.
  let Some(item) = certificate_item(&certificate) else {
    return result(Outcome::Failed(
      "Could not create a keychain item".to_string(),
    ));
  };
  let status = unsafe { SecItemAdd(item.0, std::ptr::null_mut()) };
  if status != ERR_SEC_SUCCESS && status != ERR_SEC_DUPLICATE_ITEM {
    return result(Outcome::Failed(error_message(status)));
  }

  // No settings means trusting the CA for everything, which Firefox requires (or for SSL only).
  let status = unsafe {
    SecTrustSettingsSetTrustSettings(
      certificate.0,
      K_SEC_TRUST_SETTINGS_DOMAIN_USER,
      std::ptr::null(),
    )
  };
  match status {
    ERR_SEC_SUCCESS => result(Outcome::Done),
    ERR_AUTHORIZATION_CANCELED => result(Outcome::Canceled),
    ERR_AUTHORIZATION_INTERACTION_NOT_ALLOWED if std::io::stdin().is_terminal() => {
      options.log(
        LogLevel::Info,
        "No password dialog can be shown, so Parcel will trust it for all users with sudo.",
      );
      let status = Command::new("sudo")
        .args([
          "security",
          "add-trusted-cert",
          "-d",
          "-r",
          "trustRoot",
          "-k",
        ])
        .arg(SYSTEM_KEYCHAIN)
        .arg(ca_path)
        .status();
      vec![StoreResult {
        store: "System keychain".to_string(),
        outcome: match status {
          Ok(status) if status.success() => Outcome::Done,
          Ok(_) => Outcome::Failed("security add-trusted-cert failed".to_string()),
          Err(err) => Outcome::Failed(format!("Could not run sudo: {err}")),
        },
      }]
    }
    ERR_AUTHORIZATION_INTERACTION_NOT_ALLOWED => result(Outcome::Unavailable(
      "No password dialog can be shown. Run `parcel trust` in a terminal".to_string(),
    )),
    status => result(Outcome::Failed(error_message(status))),
  }
}

pub fn remove(ca: &LocalCa, ca_path: &Path) -> Vec<StoreResult> {
  let Some(certificate) = certificate(&ca.cert_der()) else {
    return vec![StoreResult {
      store: "login keychain".to_string(),
      outcome: Outcome::Failed("Invalid certificate".to_string()),
    }];
  };
  let mut results = Vec::new();

  let mut outcome = Outcome::Unchanged;
  if has_trust_settings(&certificate, K_SEC_TRUST_SETTINGS_DOMAIN_USER) {
    outcome = match unsafe {
      SecTrustSettingsRemoveTrustSettings(certificate.0, K_SEC_TRUST_SETTINGS_DOMAIN_USER)
    } {
      ERR_SEC_SUCCESS | ERR_SEC_ITEM_NOT_FOUND => Outcome::Done,
      ERR_AUTHORIZATION_CANCELED => Outcome::Canceled,
      status => Outcome::Failed(error_message(status)),
    };
  }
  // The certificate stays in the keychain if its trust settings couldn't be removed, so that they
  // can be later.
  if matches!(outcome, Outcome::Done | Outcome::Unchanged) {
    match delete_from_keychain(&ca.cert_der()) {
      Outcome::Unchanged => {}
      deleted => outcome = deleted,
    }
  }
  results.push(StoreResult {
    store: "login keychain".to_string(),
    outcome,
  });

  // Trusted with sudo for lack of a password dialog.
  if has_trust_settings(&certificate, K_SEC_TRUST_SETTINGS_DOMAIN_ADMIN) {
    let sha1 = ring::digest::digest(&ring::digest::SHA1_FOR_LEGACY_USE_ONLY, &ca.cert_der());
    let sha1: String = sha1.as_ref().iter().map(|b| format!("{b:02X}")).collect();
    let removed = Command::new("sudo")
      .args(["security", "remove-trusted-cert", "-d"])
      .arg(ca_path)
      .status()
      .is_ok_and(|status| status.success())
      && Command::new("sudo")
        .args([
          "security",
          "delete-certificate",
          "-Z",
          &sha1,
          SYSTEM_KEYCHAIN,
        ])
        .status()
        .is_ok_and(|status| status.success());
    results.push(StoreResult {
      store: "System keychain".to_string(),
      outcome: if removed {
        Outcome::Done
      } else {
        Outcome::Failed("security remove-trusted-cert failed".to_string())
      },
    });
  }
  results
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn an_untrusted_ca_is_not_trusted() {
    let dir = std::env::temp_dir().join(format!("parcel-trust-macos-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let (ca, _) = LocalCa::load_or_create(&dir).unwrap();
    assert!(!is_trusted(&ca));
    std::fs::remove_dir_all(&dir).unwrap();
  }

  /// Adding a certificate to the keychain and deleting it doesn't need the user's permission,
  /// unlike changing trust settings. Ignored by default since it changes the login keychain.
  #[test]
  #[ignore]
  fn adds_and_deletes_keychain_items() {
    let dir = std::env::temp_dir().join(format!("parcel-keychain-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let (ca, _) = LocalCa::load_or_create(&dir).unwrap();
    let certificate = certificate(&ca.cert_der()).unwrap();
    let item = certificate_item(&certificate).unwrap();
    assert_eq!(
      unsafe { SecItemAdd(item.0, std::ptr::null_mut()) },
      ERR_SEC_SUCCESS
    );
    assert_eq!(
      unsafe { SecItemAdd(item.0, std::ptr::null_mut()) },
      ERR_SEC_DUPLICATE_ITEM
    );
    // In a keychain but not trusted.
    assert!(!is_trusted(&ca));
    assert!(!has_trust_settings(
      &certificate,
      K_SEC_TRUST_SETTINGS_DOMAIN_USER
    ));
    // Found by its data, as when removing the CA.
    assert_eq!(delete_from_keychain(&ca.cert_der()), Outcome::Done);
    assert_eq!(delete_from_keychain(&ca.cert_der()), Outcome::Unchanged);
    std::fs::remove_dir_all(&dir).unwrap();
  }
}
