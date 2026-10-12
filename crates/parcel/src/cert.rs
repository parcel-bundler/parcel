//! Certificates for `--https` without `--cert`: a local certificate authority, created once per user
//! and shared by all projects so that trusting it once is enough, which signs a certificate for
//! each hostname clients ask for.

use std::{
  collections::HashMap,
  fmt,
  net::{IpAddr, Ipv4Addr, Ipv6Addr, UdpSocket},
  path::{Path, PathBuf},
  sync::{Arc, Mutex},
  time::{Duration, SystemTime},
};

use rcgen::{
  BasicConstraints, CertificateParams, DistinguishedName, DnType, ExtendedKeyUsagePurpose, IsCa,
  Issuer, KeyPair, KeyUsagePurpose, SanType,
};
use rustls::{
  crypto::CryptoProvider,
  pki_types::{PrivateKeyDer, PrivatePkcs8KeyDer},
  server::{ClientHello, ResolvesServerCert},
  sign::CertifiedKey,
};

pub const CA_NAME: &str = "Parcel Development CA";
pub const CA_CERT_FILE: &str = "rootCA.pem";
const CA_KEY_FILE: &str = "rootCA-key.pem";
const DAY: Duration = Duration::from_secs(24 * 60 * 60);

/// Signs certificates for clients' hostnames, after the certificates of clients that don't send
/// one, i.e. those connecting to an IP address.
const MAX_CERTIFICATES: usize = 256;

/// The directory holding the local CA, which can be set with the `PARCEL_CAROOT` environment
/// variable, like mkcert's `CAROOT`.
pub fn ca_dir() -> Option<PathBuf> {
  if let Some(dir) = std::env::var_os("PARCEL_CAROOT") {
    return Some(dir.into());
  }
  let home = || std::env::var_os("HOME").map(PathBuf::from);
  let data_dir = if cfg!(target_os = "macos") {
    home()?.join("Library/Application Support")
  } else if cfg!(windows) {
    std::env::var_os("LOCALAPPDATA")?.into()
  } else {
    match std::env::var_os("XDG_DATA_HOME") {
      Some(dir) => dir.into(),
      None => home()?.join(".local/share"),
    }
  };
  Some(data_dir.join("parcel"))
}

pub struct LocalCa {
  issuer: Issuer<'static, KeyPair>,
  /// The CA's certificate in PEM format, e.g. to install in trust stores.
  pub cert_pem: String,
}

impl fmt::Debug for LocalCa {
  fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
    f.debug_struct("LocalCa").finish_non_exhaustive()
  }
}

impl LocalCa {
  /// Loads the CA in `dir`, creating it if it doesn't exist. Returns whether it was created.
  pub fn load_or_create(dir: &Path) -> Result<(Self, bool), String> {
    match Self::load(dir) {
      Ok(ca) => return Ok((ca, false)),
      Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
      Err(err) => {
        return Err(format!(
          "Could not read the local certificate authority in {}: {err}",
          dir.display()
        ));
      }
    }
    let ca = Self::create(dir).map_err(|err| {
      format!(
        "Could not create a local certificate authority in {}: {err}",
        dir.display()
      )
    })?;
    // Another process may have created one first, in which case that one is used.
    match Self::load(dir) {
      Ok(existing) if existing.cert_pem != ca.cert_pem => Ok((existing, false)),
      _ => Ok((ca, true)),
    }
  }

  pub fn load(dir: &Path) -> std::io::Result<Self> {
    let cert_pem = std::fs::read_to_string(dir.join(CA_CERT_FILE))?;
    let key = std::fs::read_to_string(dir.join(CA_KEY_FILE))?;
    let key = KeyPair::from_pem(&key)
      .map_err(|err| std::io::Error::new(std::io::ErrorKind::InvalidData, err))?;
    Ok(LocalCa {
      issuer: Issuer::new(ca_params(), key),
      cert_pem,
    })
  }

  /// Creates a CA, writing it to `dir` unless one is already there.
  fn create(dir: &Path) -> std::io::Result<Self> {
    let key = KeyPair::generate().map_err(std::io::Error::other)?;
    let mut params = ca_params();
    let now = SystemTime::now();
    params.not_before = (now - DAY).into();
    params.not_after = (now + 10 * 365 * DAY).into();
    let cert = params.self_signed(&key).map_err(std::io::Error::other)?;
    let ca = LocalCa {
      cert_pem: cert.pem(),
      issuer: Issuer::new(params, key),
    };

    // The files are written to a temporary directory that is then renamed, which fails if the
    // directory exists, so that concurrent processes agree on one CA.
    let parent = dir.parent().unwrap_or(dir);
    std::fs::create_dir_all(parent)?;
    static ATTEMPT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let attempt = ATTEMPT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let temp = parent.join(format!(".parcel-ca-{}-{attempt}", std::process::id()));
    let _ = std::fs::remove_dir_all(&temp);
    std::fs::create_dir(&temp)?;
    let result = (|| {
      std::fs::write(temp.join(CA_CERT_FILE), &ca.cert_pem)?;
      write_private(&temp.join(CA_KEY_FILE), &ca.issuer.key().serialize_pem())?;
      std::fs::rename(&temp, dir)
    })();
    if result.is_err() {
      let _ = std::fs::remove_dir_all(&temp);
      if !dir.join(CA_KEY_FILE).exists() {
        result?;
      }
    }
    Ok(ca)
  }

  /// The CA's certificate in DER format.
  pub fn cert_der(&self) -> Vec<u8> {
    pem_der(&self.cert_pem).unwrap_or_default()
  }

  /// A hex SHA-256 fingerprint of the CA's certificate, identifying it among CAs created earlier.
  #[cfg(all(unix, not(target_os = "macos")))]
  pub fn fingerprint(&self) -> String {
    let digest = ring::digest::digest(&ring::digest::SHA256, &self.cert_der());
    digest.as_ref().iter().map(|b| format!("{b:02x}")).collect()
  }

  /// A certificate for `localhost` signed by the CA, in DER format, e.g. to check whether the system
  /// trusts the CA.
  pub fn localhost_der(&self) -> Option<Vec<u8>> {
    let name = SanType::DnsName(rcgen::string::Ia5String::try_from("localhost").ok()?);
    let (pem, _) = self.sign(&[name]).ok()?;
    pem_der(&pem)
  }

  /// Signs a certificate for `names`, valid for a year, with a new key.
  fn sign(&self, names: &[SanType]) -> Result<(String, KeyPair), rcgen::Error> {
    let key = KeyPair::generate()?;
    let mut params = CertificateParams::default();
    params.distinguished_name = DistinguishedName::new();
    params
      .distinguished_name
      .push(DnType::OrganizationName, "Parcel development certificate");
    params.subject_alt_names = names.to_vec();
    params.key_usages = vec![KeyUsagePurpose::DigitalSignature];
    params.extended_key_usages = vec![ExtendedKeyUsagePurpose::ServerAuth];
    params.use_authority_key_identifier_extension = true;
    let now = SystemTime::now();
    params.not_before = (now - DAY).into();
    params.not_after = (now + 365 * DAY).into();
    let cert = params.signed_by(&key, &self.issuer)?;
    Ok((cert.pem(), key))
  }

  fn certified_key(
    &self,
    names: &[SanType],
    provider: &CryptoProvider,
  ) -> Result<Arc<CertifiedKey>, String> {
    let (cert_pem, key) = self.sign(names).map_err(|err| err.to_string())?;
    let cert =
      rustls::pki_types::CertificateDer::from(pem_der(&cert_pem).ok_or("Invalid certificate PEM")?);
    let key = PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(key.serialize_der()));
    let key = provider
      .key_provider
      .load_private_key(key)
      .map_err(|err| err.to_string())?;
    Ok(Arc::new(CertifiedKey::new(vec![cert], key)))
  }
}

/// The parameters of the local CA. They're the same for every CA so that one can be loaded from
/// just its key: certificates it signs name it as their issuer by its distinguished name. Changing
/// the name would break CAs users have already created and trusted.
fn ca_params() -> CertificateParams {
  let mut params = CertificateParams::default();
  params.distinguished_name = DistinguishedName::new();
  params
    .distinguished_name
    .push(DnType::OrganizationName, CA_NAME);
  params.distinguished_name.push(DnType::CommonName, CA_NAME);
  params.is_ca = IsCa::Ca(BasicConstraints::Constrained(0));
  params.key_usages = vec![KeyUsagePurpose::KeyCertSign, KeyUsagePurpose::CrlSign];
  params
}

fn pem_der(pem: &str) -> Option<Vec<u8>> {
  use rustls::pki_types::{CertificateDer, pem::PemObject};
  CertificateDer::from_pem_slice(pem.as_bytes())
    .ok()
    .map(|der| der.to_vec())
}

/// Writes `contents` to a new file at `path` that only the user can read.
fn write_private(path: &Path, contents: &str) -> std::io::Result<()> {
  use std::io::Write;
  let mut options = std::fs::OpenOptions::new();
  options.write(true).create_new(true);
  #[cfg(unix)]
  {
    use std::os::unix::fs::OpenOptionsExt;
    options.mode(0o600);
  }
  options.open(path)?.write_all(contents.as_bytes())
}

/// Serves certificates signed by the local CA: one for the hostname each client asks for, signed
/// on first use, and otherwise one for the addresses the server is reachable at locally.
pub struct CertResolver {
  ca: LocalCa,
  provider: Arc<CryptoProvider>,
  default: Arc<CertifiedKey>,
  by_name: Mutex<HashMap<String, Arc<CertifiedKey>>>,
}

impl fmt::Debug for CertResolver {
  fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
    f.debug_struct("CertResolver").finish_non_exhaustive()
  }
}

impl CertResolver {
  /// `host` is the address the server listens on.
  pub fn new(ca: LocalCa, provider: Arc<CryptoProvider>, host: &str) -> Result<Self, String> {
    let default = ca.certified_key(&default_names(host), &provider)?;
    Ok(CertResolver {
      ca,
      provider,
      default,
      by_name: Mutex::new(HashMap::new()),
    })
  }
}

impl ResolvesServerCert for CertResolver {
  fn resolve(&self, client_hello: ClientHello<'_>) -> Option<Arc<CertifiedKey>> {
    let Some(name) = client_hello.server_name() else {
      return Some(self.default.clone());
    };
    let name = name.to_ascii_lowercase();
    let mut by_name = self.by_name.lock().unwrap();
    if let Some(key) = by_name.get(&name) {
      return Some(key.clone());
    }
    if by_name.len() >= MAX_CERTIFICATES {
      return Some(self.default.clone());
    }
    let key = rcgen::string::Ia5String::try_from(name.clone())
      .ok()
      .and_then(|dns| {
        self
          .ca
          .certified_key(&[SanType::DnsName(dns)], &self.provider)
          .ok()
      })
      .unwrap_or_else(|| self.default.clone());
    by_name.insert(name, key.clone());
    Some(key)
  }
}

/// The names of the certificate for clients that don't say which hostname they connect to.
fn default_names(host: &str) -> Vec<SanType> {
  let mut ips = vec![
    IpAddr::V4(Ipv4Addr::LOCALHOST),
    IpAddr::V6(Ipv6Addr::LOCALHOST),
  ];
  match host.parse::<IpAddr>() {
    // Listening on all interfaces, the server is reachable from other devices, e.g. phones, at the
    // address of the interface used to reach the internet. Connecting a UDP socket sends nothing.
    Ok(ip) if ip.is_unspecified() => {
      if let Some(ip) = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0))
        .and_then(|socket| {
          socket.connect((Ipv4Addr::new(192, 0, 2, 1), 80))?;
          socket.local_addr()
        })
        .ok()
        .map(|address| address.ip())
        .filter(|ip| !ip.is_unspecified())
      {
        ips.push(ip);
      }
    }
    Ok(ip) => ips.push(ip),
    Err(_) => {}
  }
  ips.dedup();

  let mut names = vec![SanType::DnsName(
    rcgen::string::Ia5String::try_from("localhost").unwrap(),
  )];
  if host.parse::<IpAddr>().is_err()
    && host != "localhost"
    && let Ok(host) = rcgen::string::Ia5String::try_from(host)
  {
    names.push(SanType::DnsName(host));
  }
  names.extend(ips.into_iter().map(SanType::IpAddress));
  names
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn creates_the_ca_once() {
    let dir = std::env::temp_dir().join(format!("parcel-ca-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);

    let (ca, created) = LocalCa::load_or_create(&dir.join("parcel")).unwrap();
    assert!(created);
    let (loaded, created) = LocalCa::load_or_create(&dir.join("parcel")).unwrap();
    assert!(!created);
    assert_eq!(loaded.cert_pem, ca.cert_pem);
    #[cfg(unix)]
    {
      use std::os::unix::fs::PermissionsExt;
      let mode = std::fs::metadata(dir.join("parcel").join(CA_KEY_FILE))
        .unwrap()
        .permissions()
        .mode();
      assert_eq!(mode & 0o777, 0o600);
    }

    std::fs::remove_dir_all(&dir).unwrap();
  }

  /// Completes a TLS handshake with `server_name` at `address`, trusting only `ca_pem`.
  fn handshake(
    address: std::net::SocketAddr,
    ca_pem: &str,
    server_name: &str,
  ) -> Result<(), String> {
    use rustls::pki_types::{CertificateDer, ServerName, pem::PemObject};
    use std::io::{Read, Write};
    let mut roots = rustls::RootCertStore::empty();
    roots
      .add(CertificateDer::from_pem_slice(ca_pem.as_bytes()).unwrap())
      .unwrap();
    let config = rustls::ClientConfig::builder_with_provider(crate::http::crypto_provider())
      .with_safe_default_protocol_versions()
      .unwrap()
      .with_root_certificates(roots)
      .with_no_client_auth();
    let connection = rustls::ClientConnection::new(
      Arc::new(config),
      ServerName::try_from(server_name.to_owned()).unwrap(),
    )
    .unwrap();
    let mut stream =
      rustls::StreamOwned::new(connection, std::net::TcpStream::connect(address).unwrap());
    write!(
      stream,
      "GET / HTTP/1.1\r\nHost: {server_name}\r\nConnection: close\r\n\r\n"
    )
    .map_err(|err| err.to_string())?;
    let mut response = Vec::new();
    let _ = stream.read_to_end(&mut response);
    assert!(response.starts_with(b"HTTP/1.1 200 OK"));
    Ok(())
  }

  #[test]
  fn signs_certificates_for_each_hostname() {
    let dir = std::env::temp_dir().join(format!("parcel-ca-resolver-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let (created, _) = LocalCa::load_or_create(&dir).unwrap();
    let trusted_pem = created.cert_pem.clone();
    drop(created);

    // Certificates signed by the CA loaded from disk chain to the certificate trusted when it was
    // created.
    let (ca, created) = LocalCa::load_or_create(&dir).unwrap();
    assert!(!created);
    let provider = crate::http::crypto_provider();
    let resolver = CertResolver::new(ca, provider.clone(), "0.0.0.0").unwrap();
    let tls = crate::http::resolver_tls_config(provider, Arc::new(resolver)).unwrap();
    let server = crate::http::Server::bind("127.0.0.1:0", Some(tls)).unwrap();
    let address = server.local_addr().unwrap();
    server.run(|_| crate::http::Reply::Respond(crate::http::Response::new(200, "")));

    for name in [
      "localhost",
      "127.0.0.1",
      "::1",
      "app.localhost",
      "my-app.test",
    ] {
      let address = match name {
        "::1" => std::net::SocketAddr::new(Ipv6Addr::LOCALHOST.into(), address.port()),
        _ => address,
      };
      if name == "::1" && std::net::TcpStream::connect(address).is_err() {
        continue;
      }
      handshake(address, &trusted_pem, name).unwrap_or_else(|err| panic!("{name}: {err}"));
    }

    // Another CA's certificates aren't trusted.
    let (other, _) = LocalCa::load_or_create(&dir.join("other")).unwrap();
    assert!(handshake(address, &other.cert_pem, "localhost").is_err());

    std::fs::remove_dir_all(&dir).unwrap();
  }
}
