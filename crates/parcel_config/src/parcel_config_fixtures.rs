use std::path::PathBuf;
use std::rc::Rc;

use indexmap::indexmap;
use indexmap::IndexMap;

use super::parcel_config::ParcelConfig;
use super::pipeline::PipelineMap;
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

pub fn config(project_root: &PathBuf) -> (String, ConfigFixture) {
  (
    String::from("@config/default"),
    default_config(&Rc::from(
      project_root
        .join("node_modules")
        .join("@config/default")
        .join("index.json"),
    )),
  )
}

pub fn fallback_config(project_root: &PathBuf) -> (String, ConfigFixture) {
  (
    String::from("@parcel/config-default"),
    default_config(&Rc::from(
      project_root
        .join("node_modules")
        .join("@parcel/config-default")
        .join("index.json"),
    )),
  )
}

pub fn default_config(resolve_from: &Rc<PathBuf>) -> ConfigFixture {
  ConfigFixture {
    parcel_config: ParcelConfig {
      bundler: PluginNode {
        package_name: String::from("@parcel/bundler-default"),
        resolve_from: Rc::clone(&resolve_from),
      },
      compressors: PipelineMap::new(indexmap! {
        String::from("*") => vec!(PluginNode {
          package_name: String::from("@parcel/compressor-raw"),
          resolve_from: Rc::clone(&resolve_from),
        })
      }),
      namers: vec![PluginNode {
        package_name: String::from("@parcel/namer-default"),
        resolve_from: Rc::clone(&resolve_from),
      }],
      optimizers: PipelineMap::new(indexmap! {
        String::from("*.{js,mjs,cjs}") => vec!(PluginNode {
          package_name: String::from("@parcel/optimizer-swc"),
          resolve_from: Rc::clone(&resolve_from),
        })
      }),
      packagers: indexmap! {
        String::from("*.{js,mjs,cjs}") => PluginNode {
          package_name: String::from("@parcel/packager-js"),
          resolve_from: Rc::clone(&resolve_from),
        }
      },
      reporters: vec![PluginNode {
        package_name: String::from("@parcel/reporter-dev-server"),
        resolve_from: Rc::clone(&resolve_from),
      }],
      resolvers: vec![PluginNode {
        package_name: String::from("@parcel/resolver-default"),
        resolve_from: Rc::clone(&resolve_from),
      }],
      runtimes: vec![PluginNode {
        package_name: String::from("@parcel/runtime-js"),
        resolve_from: Rc::clone(&resolve_from),
      }],
      transformers: PipelineMap::new(indexmap! {
        String::from("*.{js,mjs,jsm,jsx,es6,cjs,ts,tsx}") => vec!(PluginNode {
          package_name: String::from("@parcel/transformer-js"),
          resolve_from: Rc::clone(&resolve_from),
        })
      }),
      validators: PipelineMap::new(IndexMap::new()),
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
  project_root: &PathBuf,
  base_resolve_from: Rc<PathBuf>,
) -> ExtendedConfigFixture {
  let extended_resolve_from = Rc::from(
    project_root
      .join("node_modules")
      .join("@parcel/config-default")
      .join("index.json"),
  );

  let extended_config = default_config(&extended_resolve_from);

  ExtendedConfigFixture {
    parcel_config: ParcelConfig {
      bundler: PluginNode {
        package_name: String::from("@parcel/bundler-default"),
        resolve_from: Rc::clone(&extended_resolve_from),
      },
      compressors: PipelineMap::new(indexmap! {
        String::from("*") => vec!(PluginNode {
          package_name: String::from("@parcel/compressor-raw"),
          resolve_from: Rc::clone(&extended_resolve_from),
        })
      }),
      namers: vec![PluginNode {
        package_name: String::from("@parcel/namer-default"),
        resolve_from: Rc::clone(&extended_resolve_from),
      }],
      optimizers: PipelineMap::new(indexmap! {
        String::from("*.{js,mjs,cjs}") => vec!(PluginNode {
          package_name: String::from("@parcel/optimizer-swc"),
          resolve_from: Rc::clone(&extended_resolve_from),
        })
      }),
      packagers: indexmap! {
        String::from("*.{js,mjs,cjs}") => PluginNode {
          package_name: String::from("@parcel/packager-js"),
          resolve_from: Rc::clone(&extended_resolve_from),
        }
      },
      reporters: vec![
        PluginNode {
          package_name: String::from("@parcel/reporter-dev-server"),
          resolve_from: Rc::clone(&extended_resolve_from),
        },
        PluginNode {
          package_name: String::from("@scope/parcel-metrics-reporter"),
          resolve_from: Rc::clone(&base_resolve_from),
        },
      ],
      resolvers: vec![PluginNode {
        package_name: String::from("@parcel/resolver-default"),
        resolve_from: Rc::clone(&extended_resolve_from),
      }],
      runtimes: vec![PluginNode {
        package_name: String::from("@parcel/runtime-js"),
        resolve_from: Rc::clone(&extended_resolve_from),
      }],
      transformers: PipelineMap::new(indexmap! {
        String::from("*.{js,mjs,jsm,jsx,es6,cjs,ts,tsx}") => vec!(PluginNode {
          package_name: String::from("@parcel/transformer-js"),
          resolve_from: Rc::clone(&extended_resolve_from),
        }),
        String::from("*.{ts,tsx}") => vec!(PluginNode {
          package_name: String::from("@scope/parcel-transformer-ts"),
          resolve_from: Rc::clone(&base_resolve_from),
        }),
      }),
      validators: PipelineMap::new(IndexMap::new()),
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

pub fn default_extended_config(project_root: &PathBuf) -> ExtendedConfigFixture {
  let base_resolve_from = Rc::from(project_root.join(".parcelrc"));

  extended_config_from(project_root, base_resolve_from)
}

pub fn extended_config(project_root: &PathBuf) -> (String, ExtendedConfigFixture) {
  let base_resolve_from = Rc::from(
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
