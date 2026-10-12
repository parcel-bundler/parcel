//! Trust on Windows: the CA is added to the current user's trusted root store, which Chrome, Edge,
//! and Firefox all read. Windows asks the user to confirm adding or removing a root.

use std::path::Path;

use windows_sys::Win32::{
  Foundation::{ERROR_CANCELLED, GetLastError},
  Security::Cryptography::{
    CERT_CONTEXT, CERT_FIND_EXISTING, CERT_STORE_ADD_USE_EXISTING,
    CertAddEncodedCertificateToStore, CertCloseStore, CertCreateCertificateContext,
    CertDeleteCertificateFromStore, CertFindCertificateInStore, CertFreeCertificateContext,
    CertOpenSystemStoreW, HCERTSTORE, X509_ASN_ENCODING,
  },
};

use parcel_core::ParcelOptions;

use super::{Outcome, StoreResult};
use crate::cert::LocalCa;

/// Shown before installing. Windows' own dialog asks for consent.
pub const CONFIRM: bool = false;

const STORE: &str = "Windows certificate store";

/// `HRESULT_FROM_WIN32(ERROR_CANCELLED)`, which the store reports when the user declines.
const E_CANCELLED: u32 = 0x800704C7;

/// The current user's trusted root store, which includes the machine's.
struct RootStore(HCERTSTORE);

impl RootStore {
  fn open() -> Option<Self> {
    let name: Vec<u16> = "ROOT".encode_utf16().chain([0]).collect();
    let store = unsafe { CertOpenSystemStoreW(0, name.as_ptr()) };
    (!store.is_null()).then_some(RootStore(store))
  }

  /// The store's copy of the certificate `der`, if it has one.
  fn find(&self, der: &[u8]) -> Option<Context> {
    let certificate = Context::new(der)?;
    let found = unsafe {
      CertFindCertificateInStore(
        self.0,
        X509_ASN_ENCODING,
        0,
        CERT_FIND_EXISTING,
        certificate.0 as *const _,
        std::ptr::null(),
      )
    };
    (!found.is_null()).then_some(Context(found))
  }
}

impl Drop for RootStore {
  fn drop(&mut self) {
    unsafe { CertCloseStore(self.0, 0) };
  }
}

struct Context(*mut CERT_CONTEXT);

impl Context {
  fn new(der: &[u8]) -> Option<Self> {
    let context =
      unsafe { CertCreateCertificateContext(X509_ASN_ENCODING, der.as_ptr(), der.len() as u32) };
    (!context.is_null()).then_some(Context(context))
  }
}

impl Drop for Context {
  fn drop(&mut self) {
    if !self.0.is_null() {
      unsafe { CertFreeCertificateContext(self.0) };
    }
  }
}

fn last_error() -> Outcome {
  match unsafe { GetLastError() } {
    ERROR_CANCELLED | E_CANCELLED => Outcome::Canceled,
    code => Outcome::Failed(format!(
      "{}",
      std::io::Error::from_raw_os_error(code as i32)
    )),
  }
}

pub fn is_trusted(ca: &LocalCa) -> bool {
  RootStore::open().is_some_and(|store| store.find(&ca.cert_der()).is_some())
}

pub fn explanation(_ca: &LocalCa, _ca_path: &Path) -> String {
  "To make browsers trust it, Parcel will add it to your trusted root certificates. Windows will \
   ask you to confirm."
    .to_string()
}

pub fn install(ca: &LocalCa, _ca_path: &Path, _options: &ParcelOptions) -> Vec<StoreResult> {
  let outcome = match RootStore::open() {
    None => last_error(),
    Some(store) if store.find(&ca.cert_der()).is_some() => Outcome::Unchanged,
    Some(store) => {
      let der = ca.cert_der();
      let added = unsafe {
        CertAddEncodedCertificateToStore(
          store.0,
          X509_ASN_ENCODING,
          der.as_ptr(),
          der.len() as u32,
          CERT_STORE_ADD_USE_EXISTING,
          std::ptr::null_mut(),
        )
      };
      if added != 0 {
        Outcome::Done
      } else {
        last_error()
      }
    }
  };
  vec![StoreResult {
    store: STORE.to_string(),
    outcome,
  }]
}

pub fn remove(ca: &LocalCa, _ca_path: &Path) -> Vec<StoreResult> {
  let outcome = match RootStore::open() {
    None => last_error(),
    Some(store) => match store.find(&ca.cert_der()) {
      None => Outcome::Unchanged,
      Some(mut found) => {
        // Deleting frees the context, even on failure.
        let deleted = unsafe { CertDeleteCertificateFromStore(found.0) };
        found.0 = std::ptr::null_mut();
        if deleted != 0 {
          Outcome::Done
        } else {
          last_error()
        }
      }
    },
  };
  vec![StoreResult {
    store: STORE.to_string(),
    outcome,
  }]
}
