use std::path::Path;
use std::path::PathBuf;
use std::sync::Arc;

use indexmap::indexmap;
use indexmap::IndexMap;

use super::atlaspack_config::AtlaspackConfig;
use super::map::NamedPipelinesMap;
use crate::atlaspack_config::PluginNode;
use crate::map::PipelineMap;
use crate::map::PipelinesMap;

pub struct ConfigFixture {
  pub atlaspack_config: AtlaspackConfig,
  pub atlaspack_rc: String,
  pub path: PathBuf,
}

pub struct PartialConfigFixture {
  pub atlaspack_rc: String,
  pub path: PathBuf,
}

pub struct ExtendedConfigFixture {
  pub base_config: PartialConfigFixture,
  pub extended_config: PartialConfigFixture,
  pub atlaspack_config: AtlaspackConfig,
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
    String::from("@atlaspack/config-default"),
    default_config(Arc::new(
      project_root
        .join("node_modules")
        .join("@atlaspack/config-default")
        .join("index.json"),
    )),
  )
}

pub fn default_config(resolve_from: Arc<PathBuf>) -> ConfigFixture {
  ConfigFixture {
    atlaspack_config: AtlaspackConfig {
      bundler: PluginNode {
        package_name: String::from("@atlaspack/bundler-default"),
        resolve_from: resolve_from.clone(),
      },
      compressors: PipelinesMap::new(indexmap! {
        String::from("*") => vec!(PluginNode {
          package_name: String::from("@atlaspack/compressor-raw"),
          resolve_from: resolve_from.clone(),
        })
      }),
      namers: vec![PluginNode {
        package_name: String::from("@atlaspack/namer-default"),
        resolve_from: resolve_from.clone(),
      }],
      optimizers: NamedPipelinesMap::new(indexmap! {
        String::from("*.{js,mjs,cjs}") => vec!(PluginNode {
          package_name: String::from("@atlaspack/optimizer-swc"),
          resolve_from: resolve_from.clone(),
        })
      }),
      packagers: PipelineMap::new(indexmap! {
        String::from("*.{js,mjs,cjs}") => PluginNode {
          package_name: String::from("@atlaspack/packager-js"),
          resolve_from: resolve_from.clone(),
        }
      }),
      reporters: vec![PluginNode {
        package_name: String::from("@atlaspack/reporter-dev-server"),
        resolve_from: resolve_from.clone(),
      }],
      resolvers: vec![PluginNode {
        package_name: String::from("@atlaspack/resolver-default"),
        resolve_from: resolve_from.clone(),
      }],
      runtimes: vec![PluginNode {
        package_name: String::from("@atlaspack/runtime-js"),
        resolve_from: resolve_from.clone(),
      }],
      transformers: NamedPipelinesMap::new(indexmap! {
        String::from("*.{js,mjs,jsm,jsx,es6,cjs,ts,tsx}") => vec!(PluginNode {
          package_name: String::from("@atlaspack/transformer-js"),
          resolve_from: resolve_from.clone(),
        })
      }),
      validators: PipelinesMap::new(IndexMap::new()),
    },
    atlaspack_rc: String::from(
      r#"
        {
          "bundler": "@atlaspack/bundler-default",
          "compressors": {
            "*": ["@atlaspack/compressor-raw"]
          },
          "namers": ["@atlaspack/namer-default"],
          "optimizers": {
            "*.{js,mjs,cjs}": ["@atlaspack/optimizer-swc"]
          },
          "packagers": {
            "*.{js,mjs,cjs}": "@atlaspack/packager-js"
          },
          "reporters": ["@atlaspack/reporter-dev-server"],
          "resolvers": ["@atlaspack/resolver-default"],
          "runtimes": ["@atlaspack/runtime-js"],
          "transformers": {
            "*.{js,mjs,jsm,jsx,es6,cjs,ts,tsx}": [
              "@atlaspack/transformer-js"
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
      .join("@atlaspack/config-default")
      .join("index.json"),
  );

  let extended_config = default_config(extended_resolve_from.clone());

  ExtendedConfigFixture {
    atlaspack_config: AtlaspackConfig {
      bundler: PluginNode {
        package_name: String::from("@atlaspack/bundler-default"),
        resolve_from: extended_resolve_from.clone(),
      },
      compressors: PipelinesMap::new(indexmap! {
        String::from("*") => vec!(PluginNode {
          package_name: String::from("@atlaspack/compressor-raw"),
          resolve_from: extended_resolve_from.clone(),
        })
      }),
      namers: vec![PluginNode {
        package_name: String::from("@atlaspack/namer-default"),
        resolve_from: extended_resolve_from.clone(),
      }],
      optimizers: NamedPipelinesMap::new(indexmap! {
        String::from("*.{js,mjs,cjs}") => vec!(PluginNode {
          package_name: String::from("@atlaspack/optimizer-swc"),
          resolve_from: extended_resolve_from.clone(),
        })
      }),
      packagers: PipelineMap::new(indexmap! {
        String::from("*.{js,mjs,cjs}") => PluginNode {
          package_name: String::from("@atlaspack/packager-js"),
          resolve_from: extended_resolve_from.clone(),
        }
      }),
      reporters: vec![
        PluginNode {
          package_name: String::from("@atlaspack/reporter-dev-server"),
          resolve_from: extended_resolve_from.clone(),
        },
        PluginNode {
          package_name: String::from("@scope/atlaspack-metrics-reporter"),
          resolve_from: base_resolve_from.clone(),
        },
      ],
      resolvers: vec![PluginNode {
        package_name: String::from("@atlaspack/resolver-default"),
        resolve_from: extended_resolve_from.clone(),
      }],
      runtimes: vec![PluginNode {
        package_name: String::from("@atlaspack/runtime-js"),
        resolve_from: extended_resolve_from.clone(),
      }],
      transformers: NamedPipelinesMap::new(indexmap! {
        String::from("*.{js,mjs,jsm,jsx,es6,cjs,ts,tsx}") => vec!(PluginNode {
          package_name: String::from("@atlaspack/transformer-js"),
          resolve_from: extended_resolve_from.clone(),
        }),
        String::from("*.{ts,tsx}") => vec!(PluginNode {
          package_name: String::from("@scope/atlaspack-transformer-ts"),
          resolve_from: base_resolve_from.clone(),
        }),
      }),
      validators: PipelinesMap::new(IndexMap::new()),
    },
    base_config: PartialConfigFixture {
      path: PathBuf::from(base_resolve_from.as_os_str()),
      atlaspack_rc: String::from(
        r#"
          {
            "extends": "@atlaspack/config-default",
            "reporters": ["...", "@scope/atlaspack-metrics-reporter"],
            "transformers": {
              "*.{ts,tsx}": [
                "@scope/atlaspack-transformer-ts",
                "..."
              ]
            }
          }
        "#,
      ),
    },
    extended_config: PartialConfigFixture {
      path: extended_config.path,
      atlaspack_rc: extended_config.atlaspack_rc,
    },
  }
}

pub fn default_extended_config(project_root: &Path) -> ExtendedConfigFixture {
  let base_resolve_from = Arc::from(project_root.join(".atlaspackrc"));

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
