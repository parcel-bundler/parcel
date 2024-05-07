use std::num::NonZeroU16;

use super::Browsers;
use super::Engines;
use super::Version;

pub enum EnvironmentFeature {
  Esmodules,
  DynamicImport,
  WorkerModule,
  ServiceWorkerModule,
  ImportMetaUrl,
  ArrowFunctions,
  GlobalThis,
}

impl EnvironmentFeature {
  pub fn engines(&self) -> Engines {
    match self {
      EnvironmentFeature::WorkerModule => Engines {
        browsers: Browsers {
          edge: Some(Version::new(NonZeroU16::new(80).unwrap(), 0)),
          chrome: Some(Version::new(NonZeroU16::new(80).unwrap(), 0)),
          opera: Some(Version::new(NonZeroU16::new(67).unwrap(), 0)),
          android: Some(Version::new(NonZeroU16::new(81).unwrap(), 0)),
          ..Default::default()
        },
        ..Default::default()
      },
      _ => todo!(),
    }
  }
}
