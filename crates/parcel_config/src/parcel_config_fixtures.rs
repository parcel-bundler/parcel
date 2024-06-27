use std::path::Path;
use std::path::PathBuf;
use std::sync::Arc;

use indexmap::indexmap;
use indexmap::IndexMap;

use super::map::NamedPipelinesMap;
use super::parcel_config::ParcelConfig;
use crate::map::PipelineMap;
use crate::map::PipelinesMap;
use crate::parcel_config::PluginNode;

pub struct ConfigFixture {
  pub parcel_config: ParcelConfig,
  pub parcel_rc: String,
  pub path: PathBuf,
}

pub struct PartialConfigFixture {
  pub parcel_rc: String,
  pub path: PathBuf,
}

pub struct ExtendedConfigFixture {
  pub base_config: PartialConfigFixture,
  pub extended_config: PartialConfigFixture,
  pub parcel_config: ParcelConfig,
}

pub fn config(project_root: &Path) -> (String, ConfigFixture) {
  (
    String::from("@config/default"),
    default_config(Arc::new(
      project_root
        .join("node_modules")
        .join("@config/default")
        .join("index.json"),
    )),
  )
}

pub fn fallback_config(project_root: &Path) -> (String, ConfigFixture) {
  (
    String::from("@parcel/config-default"),
    default_config(Arc::new(
      project_root
        .join("node_modules")
        .join("@parcel/config-default")
        .join("index.json"),
    )),
  )
}

pub fn default_config(resolve_from: Arc<PathBuf>) -> ConfigFixture {
  ConfigFixture {
    parcel_config: ParcelConfig {
      bundler: PluginNode {
        package_name: String::from("@parcel/bundler-default"),
        resolve_from: resolve_from.clone(),
      },
      compressors: PipelinesMap::new(indexmap! {
        String::from("*") => vec!(PluginNode {
          package_name: String::from("@parcel/compressor-raw"),
          resolve_from: resolve_from.clone(),
        })
      }),
      namers: vec![PluginNode {
        package_name: String::from("@parcel/namer-default"),
        resolve_from: resolve_from.clone(),
      }],
      optimizers: NamedPipelinesMap::new(indexmap! {
        String::from("*.{js,mjs,cjs}") => vec!(PluginNode {
          package_name: String::from("@parcel/optimizer-swc"),
          resolve_from: resolve_from.clone(),
        })
      }),
      packagers: PipelineMap::new(indexmap! {
        String::from("*.{js,mjs,cjs}") => PluginNode {
          package_name: String::from("@parcel/packager-js"),
          resolve_from: resolve_from.clone(),
        }
      }),
      reporters: vec![PluginNode {
        package_name: String::from("@parcel/reporter-dev-server"),
        resolve_from: resolve_from.clone(),
      }],
      resolvers: vec![PluginNode {
        package_name: String::from("@parcel/resolver-default"),
        resolve_from: resolve_from.clone(),
      }],
      runtimes: vec![PluginNode {
        package_name: String::from("@parcel/runtime-js"),
        resolve_from: resolve_from.clone(),
      }],
      transformers: NamedPipelinesMap::new(indexmap! {
        String::from("*.{js,mjs,jsm,jsx,es6,cjs,ts,tsx}") => vec!(PluginNode {
          package_name: String::from("@parcel/transformer-js"),
          resolve_from: resolve_from.clone(),
        })
      }),
      validators: PipelinesMap::new(IndexMap::new()),
    },
    parcel_rc: String::from(
      r#"
        {
          "bundler": "@parcel/bundler-default",
          "compressors": {
            "*": ["@parcel/compressor-raw"]
          },
          "namers": ["@parcel/namer-default"],
          "optimizers": {
            "*.{js,mjs,cjs}": ["@parcel/optimizer-swc"]
          },
          "packagers": {
            "*.{js,mjs,cjs}": "@parcel/packager-js"
          },
          "reporters": ["@parcel/reporter-dev-server"],
          "resolvers": ["@parcel/resolver-default"],
          "runtimes": ["@parcel/runtime-js"],
          "transformers": {
            "*.{js,mjs,jsm,jsx,es6,cjs,ts,tsx}": [
              "@parcel/transformer-js"
            ],
          }
        }
      "#,
    ),
    path: PathBuf::from(resolve_from.display().to_string()),
  }
}

fn extended_config_from(
  project_root: &Path,
  base_resolve_from: Arc<PathBuf>,
) -> ExtendedConfigFixture {
  let extended_resolve_from = Arc::new(
    project_root
      .join("node_modules")
      .join("@parcel/config-default")
      .join("index.json"),
  );

  let extended_config = default_config(extended_resolve_from.clone());

  ExtendedConfigFixture {
    parcel_config: ParcelConfig {
      bundler: PluginNode {
        package_name: String::from("@parcel/bundler-default"),
        resolve_from: extended_resolve_from.clone(),
      },
      compressors: PipelinesMap::new(indexmap! {
        String::from("*") => vec!(PluginNode {
          package_name: String::from("@parcel/compressor-raw"),
          resolve_from: extended_resolve_from.clone(),
        })
      }),
      namers: vec![PluginNode {
        package_name: String::from("@parcel/namer-default"),
        resolve_from: extended_resolve_from.clone(),
      }],
      optimizers: NamedPipelinesMap::new(indexmap! {
        String::from("*.{js,mjs,cjs}") => vec!(PluginNode {
          package_name: String::from("@parcel/optimizer-swc"),
          resolve_from: extended_resolve_from.clone(),
        })
      }),
      packagers: PipelineMap::new(indexmap! {
        String::from("*.{js,mjs,cjs}") => PluginNode {
          package_name: String::from("@parcel/packager-js"),
          resolve_from: extended_resolve_from.clone(),
        }
      }),
      reporters: vec![
        PluginNode {
          package_name: String::from("@parcel/reporter-dev-server"),
          resolve_from: extended_resolve_from.clone(),
        },
        PluginNode {
          package_name: String::from("@scope/parcel-metrics-reporter"),
          resolve_from: base_resolve_from.clone(),
        },
      ],
      resolvers: vec![PluginNode {
        package_name: String::from("@parcel/resolver-default"),
        resolve_from: extended_resolve_from.clone(),
      }],
      runtimes: vec![PluginNode {
        package_name: String::from("@parcel/runtime-js"),
        resolve_from: extended_resolve_from.clone(),
      }],
      transformers: NamedPipelinesMap::new(indexmap! {
        String::from("*.{js,mjs,jsm,jsx,es6,cjs,ts,tsx}") => vec!(PluginNode {
          package_name: String::from("@parcel/transformer-js"),
          resolve_from: extended_resolve_from.clone(),
        }),
        String::from("*.{ts,tsx}") => vec!(PluginNode {
          package_name: String::from("@scope/parcel-transformer-ts"),
          resolve_from: base_resolve_from.clone(),
        }),
      }),
      validators: PipelinesMap::new(IndexMap::new()),
    },
    base_config: PartialConfigFixture {
      path: PathBuf::from(base_resolve_from.as_os_str()),
      parcel_rc: String::from(
        r#"
          {
            "extends": "@parcel/config-default",
            "reporters": ["...", "@scope/parcel-metrics-reporter"],
            "transformers": {
              "*.{ts,tsx}": [
                "@scope/parcel-transformer-ts",
                "..."
              ]
            }
          }
        "#,
      ),
    },
    extended_config: PartialConfigFixture {
      path: extended_config.path,
      parcel_rc: extended_config.parcel_rc,
    },
  }
}

pub fn default_extended_config(project_root: &Path) -> ExtendedConfigFixture {
  let base_resolve_from = Arc::from(project_root.join(".parcelrc"));

  extended_config_from(project_root, base_resolve_from)
}

pub fn extended_config(project_root: &Path) -> (String, ExtendedConfigFixture) {
  let base_resolve_from = Arc::from(
    project_root
      .join("node_modules")
      .join("@config/default")
      .join("index.json"),
  );

  (
    String::from("@config/default"),
    extended_config_from(project_root, base_resolve_from),
  )
}
