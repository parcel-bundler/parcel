use std::collections::HashMap;
use std::ffi::OsStr;
use std::hash::Hash;
use std::path::Path;
use std::path::PathBuf;

use anyhow::anyhow;
use package_json::BrowserField;
use package_json::BrowsersList;
use package_json::BuiltInTargetDescriptor;
use package_json::ModuleFormat;
use package_json::PackageJson;
use package_json::SourceMapField;
use package_json::TargetDescriptor;
use parcel_core::types::engines::Engines;
use parcel_core::types::BuildMode;
use parcel_core::types::DefaultTargetOptions;
use parcel_core::types::Entry;
use parcel_core::types::Environment;
use parcel_core::types::EnvironmentContext;
use parcel_core::types::OutputFormat;
use parcel_core::types::SourceType;
use parcel_core::types::Target;
use parcel_core::types::TargetSourceMapOptions;
use parcel_resolver::IncludeNodeModules;

use crate::request_tracker::Request;
use crate::request_tracker::ResultAndInvalidations;
use crate::request_tracker::RunRequestContext;
use crate::request_tracker::RunRequestError;

use super::RequestResult;

mod package_json;

/// Infers how and where source code is outputted
///
/// Targets will be generated from the project package.json file and input Parcel options.
///
#[derive(Debug)]
pub struct TargetRequest {
  pub default_target_options: DefaultTargetOptions,
  pub env: Option<HashMap<String, String>>,
  pub exclusive_target: Option<String>,
  pub mode: BuildMode,
}

impl Hash for TargetRequest {
  fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
    self.default_target_options.hash(state);
    self.exclusive_target.hash(state);
    self.mode.hash(state);
  }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Targets(Vec<Target>);

struct BuiltInTarget<'a> {
  descriptor: BuiltInTargetDescriptor,
  dist: Option<PathBuf>,
  extensions: Vec<&'a str>,
  name: &'a str,
}

struct CustomTarget<'a> {
  descriptor: &'a TargetDescriptor,
  name: &'a str,
}

impl TargetRequest {
  fn builtin_target_descriptor(&self) -> TargetDescriptor {
    TargetDescriptor {
      include_node_modules: Some(IncludeNodeModules::Bool(false)),
      is_library: Some(true),
      scope_hoist: Some(true),
      ..TargetDescriptor::default()
    }
  }

  fn builtin_browser_target(
    &self,
    descriptor: Option<BuiltInTargetDescriptor>,
    dist: Option<BrowserField>,
    name: Option<String>,
  ) -> BuiltInTarget {
    BuiltInTarget {
      descriptor: descriptor.unwrap_or_else(|| {
        BuiltInTargetDescriptor::TargetDescriptor(TargetDescriptor {
          context: Some(EnvironmentContext::Browser),
          ..self.builtin_target_descriptor()
        })
      }),
      dist: dist.and_then(|browser| match browser {
        BrowserField::EntryPoint(entrypoint) => Some(entrypoint.clone()),
        BrowserField::ReplacementBySpecifier(replacements) => {
          name.and_then(|name| replacements.get(&name).map(|v| v.into()))
        }
      }),
      extensions: vec!["cjs", "js", "mjs"],
      name: "browser",
    }
  }

  fn builtin_main_target(
    &self,
    descriptor: Option<BuiltInTargetDescriptor>,
    dist: Option<PathBuf>,
  ) -> BuiltInTarget {
    BuiltInTarget {
      descriptor: descriptor.unwrap_or_else(|| {
        BuiltInTargetDescriptor::TargetDescriptor(TargetDescriptor {
          context: Some(EnvironmentContext::Node),
          ..self.builtin_target_descriptor()
        })
      }),
      dist,
      extensions: vec!["cjs", "js", "mjs"],
      name: "main",
    }
  }

  fn builtin_module_target(
    &self,
    descriptor: Option<BuiltInTargetDescriptor>,
    dist: Option<PathBuf>,
  ) -> BuiltInTarget {
    BuiltInTarget {
      descriptor: descriptor.unwrap_or_else(|| {
        BuiltInTargetDescriptor::TargetDescriptor(TargetDescriptor {
          context: Some(EnvironmentContext::Node),
          ..self.builtin_target_descriptor()
        })
      }),
      dist,
      extensions: vec!["js", "mjs"],
      name: "module",
    }
  }

  fn builtin_types_target(
    &self,
    descriptor: Option<BuiltInTargetDescriptor>,
    dist: Option<PathBuf>,
  ) -> BuiltInTarget {
    BuiltInTarget {
      descriptor: descriptor.unwrap_or_else(|| {
        BuiltInTargetDescriptor::TargetDescriptor(TargetDescriptor {
          context: Some(EnvironmentContext::Node),
          ..self.builtin_target_descriptor()
        })
      }),
      dist,
      extensions: vec!["ts"],
      name: "types",
    }
  }

  fn default_dist_dir(&self, package_path: &Path) -> PathBuf {
    package_path
      .parent()
      .unwrap_or_else(|| &package_path)
      .join("dist")
  }

  fn infer_environment_context(&self, package_json: &PackageJson) -> EnvironmentContext {
    // If there is a separate `browser` target, or an `engines.node` field but no browser
    // targets, then the target refers to node, otherwise browser.
    if package_json.browser.is_some() || package_json.targets.browser.is_some() {
      if package_json
        .engines
        .as_ref()
        .is_some_and(|e| e.node.is_some() && e.browsers.is_empty())
      {
        return EnvironmentContext::Node;
      } else {
        return EnvironmentContext::Browser;
      }
    }

    if package_json
      .engines
      .as_ref()
      .is_some_and(|e| e.node.is_some())
    {
      return EnvironmentContext::Node;
    }

    EnvironmentContext::Browser
  }

  fn infer_output_format(
    &self,
    module_format: &Option<ModuleFormat>,
    target: &TargetDescriptor,
  ) -> Result<Option<OutputFormat>, anyhow::Error> {
    let ext = target
      .dist_entry
      .as_ref()
      .and_then(|e| e.extension())
      .unwrap_or_default()
      .to_str();

    let inferred_output_format = match ext {
      Some("cjs") => Some(OutputFormat::CommonJS),
      Some("mjs") => Some(OutputFormat::EsModule),
      Some("js") => module_format.as_ref().and_then(|format| match format {
        ModuleFormat::CommonJS => Some(OutputFormat::CommonJS),
        ModuleFormat::Module => Some(OutputFormat::EsModule),
      }),
      _ => None,
    };

    if let Some(inferred_output_format) = inferred_output_format {
      if let Some(output_format) = target.output_format {
        if output_format != inferred_output_format {
          return Err(anyhow!(
            "Declared output format {} does not match expected output format {}",
            output_format,
            inferred_output_format
          ));
        }
      }
    }

    Ok(inferred_output_format)
  }

  fn load_package_json(
    &self,
    request_context: RunRequestContext,
  ) -> Result<(PathBuf, PackageJson), anyhow::Error> {
    // TODO Invalidations
    let (package_path, mut package_json) = request_context
      .config()
      .load_package_json_config::<PackageJson>()?;

    if package_json
      .engines
      .as_ref()
      .is_some_and(|e| !e.browsers.is_empty())
    {
      return Ok((package_path, package_json));
    }

    let env = self
      .env
      .as_ref()
      .and_then(|env| env.get("BROWSERSLIST_ENV").or_else(|| env.get("NODE_ENV")))
      .map(|e| e.to_owned())
      .unwrap_or_else(|| self.mode.to_string());

    match package_json.browserslist.clone() {
      // TODO Process browserslist config file
      None => {}
      Some(browserslist) => {
        let browserslist = match browserslist {
          BrowsersList::Browsers(browsers) => browsers,
          BrowsersList::BrowsersByEnv(browsers_by_env) => browsers_by_env
            .get(&env)
            .map(|b| b.clone())
            .unwrap_or_default(),
        };

        package_json.engines = Some(Engines {
          browsers: Engines::from_browserslist(browserslist),
          ..match package_json.engines {
            None => Engines::default(),
            Some(engines) => engines,
          }
        });
      }
    };

    Ok((package_path, package_json))
  }

  fn resolve_package_targets(
    &self,
    request_context: RunRequestContext,
  ) -> Result<Vec<Option<Target>>, anyhow::Error> {
    let (package_path, package_json) = self.load_package_json(request_context)?;
    let mut targets: Vec<Option<Target>> = Vec::new();

    let builtin_targets = [
      self.builtin_browser_target(
        package_json.targets.browser.clone(),
        package_json.browser.clone(),
        package_json.name.clone(),
      ),
      self.builtin_main_target(package_json.targets.main.clone(), package_json.main.clone()),
      self.builtin_module_target(
        package_json.targets.module.clone(),
        package_json.module.clone(),
      ),
      self.builtin_types_target(
        package_json.targets.types.clone(),
        package_json.types.clone(),
      ),
    ];

    for builtin_target in builtin_targets {
      if builtin_target.dist.is_none() {
        continue;
      }

      match builtin_target.descriptor {
        BuiltInTargetDescriptor::Disabled(_disabled) => continue,
        BuiltInTargetDescriptor::TargetDescriptor(builtin_target_descriptor) => {
          if builtin_target_descriptor
            .output_format
            .is_some_and(|f| f == OutputFormat::Global)
          {
            return Err(anyhow!(
              "The \"global\" output format is not supported in the {} target",
              builtin_target.name
            ));
          }

          if let Some(target_dist) = builtin_target.dist.as_ref() {
            let target_dist_ext = target_dist
              .extension()
              .unwrap_or(OsStr::new(""))
              .to_string_lossy()
              .into_owned();

            if builtin_target
              .extensions
              .iter()
              .all(|ext| &target_dist_ext != ext)
            {
              return Err(anyhow!(
                "Unexpected file type {:?} in \"{}\" target",
                target_dist.file_name().unwrap_or(OsStr::new(&target_dist)),
                builtin_target.name
              ));
            }
          }

          targets.push(self.target_from_descriptor(
            builtin_target.dist,
            &package_json,
            &package_path,
            builtin_target_descriptor,
            builtin_target.name,
          )?);
        }
      }
    }

    let custom_targets = package_json
      .targets
      .custom_targets
      .iter()
      .map(|(name, descriptor)| CustomTarget { descriptor, name });

    for custom_target in custom_targets {
      let mut dist = None;
      if let Some(value) = package_json.fields.get(custom_target.name) {
        match value {
          serde_json::Value::String(str) => {
            dist = Some(PathBuf::from(str));
          }
          _ => return Err(anyhow!("Invalid path for target {}", custom_target.name)),
        };
      }

      targets.push(self.target_from_descriptor(
        dist,
        &package_json,
        &package_path,
        custom_target.descriptor.clone(),
        &custom_target.name,
      )?);
    }

    if targets.is_empty() {
      let context = self.infer_environment_context(&package_json);

      targets.push(Some(Target {
        dist_dir: self
          .default_target_options
          .dist_dir
          .clone()
          .unwrap_or_else(|| self.default_dist_dir(&package_path)),
        dist_entry: None,
        env: Environment {
          context,
          engines: package_json
            .engines
            .unwrap_or_else(|| self.default_target_options.engines.clone()),
          include_node_modules: IncludeNodeModules::from(context),
          is_library: self.default_target_options.is_library,
          loc: None,
          output_format: self
            .default_target_options
            .output_format
            .unwrap_or_else(|| fallback_output_format(context)),
          should_optimize: self.default_target_options.should_optimize,
          should_scope_hoist: self.default_target_options.should_scope_hoist
            && self.mode == BuildMode::Production
            && !self.default_target_options.is_library,
          source_map: self
            .default_target_options
            .source_maps
            .then(|| TargetSourceMapOptions::default()),
          source_type: SourceType::Module,
        },
        loc: None,
        name: String::from("default"),
        public_url: self.default_target_options.public_url.clone(),
      }));
    }

    Ok(targets)
  }

  fn skip_target(&self, target_name: &str, source: &Option<Entry>) -> bool {
    // We skip targets if they have a descriptor.source that does not match the current
    // exclusiveTarget. They will be handled by a separate resolvePackageTargets call from their
    // Entry point but with exclusiveTarget set.
    match self.exclusive_target.as_ref() {
      None => source.is_some(),
      Some(exclusive_target) => target_name != exclusive_target,
    }
  }

  fn target_from_descriptor(
    &self,
    dist: Option<PathBuf>,
    package_json: &PackageJson,
    package_path: &Path,
    target_descriptor: TargetDescriptor,
    target_name: &str,
  ) -> Result<Option<Target>, anyhow::Error> {
    if self.skip_target(&target_name, &target_descriptor.source) {
      return Ok(None);
    }

    if target_descriptor.is_library.is_some_and(|l| l == true)
      && target_descriptor.scope_hoist.is_some_and(|s| s == false)
    {
      return Err(anyhow!(
        "Scope hoisting cannot be disabled for \"{}\" library target",
        target_name
      ));
    }

    // TODO LOC
    let context = target_descriptor
      .context
      .unwrap_or_else(|| self.infer_environment_context(&package_json));

    let inferred_output_format =
      self.infer_output_format(&package_json.module_format, &target_descriptor)?;

    let output_format = target_descriptor
      .output_format
      .or(self.default_target_options.output_format)
      .or(inferred_output_format)
      .unwrap_or_else(|| match target_name {
        "browser" => OutputFormat::CommonJS,
        "main" => OutputFormat::CommonJS,
        "module" => OutputFormat::EsModule,
        "types" => OutputFormat::CommonJS,
        _ => match context {
          EnvironmentContext::ElectronMain => OutputFormat::CommonJS,
          EnvironmentContext::ElectronRenderer => OutputFormat::CommonJS,
          EnvironmentContext::Node => OutputFormat::CommonJS,
          _ => OutputFormat::Global,
        },
      });

    if target_name == "main"
      && output_format == OutputFormat::EsModule
      && inferred_output_format.is_some_and(|f| f != OutputFormat::EsModule)
    {
      return Err(anyhow!("Output format \"esmodule\" cannot be used in the \"main\" target without a .mjs extension or \"type\": \"module\" field"));
    }

    let is_library = target_descriptor
      .is_library
      .unwrap_or_else(|| self.default_target_options.is_library);

    Ok(Some(Target {
      dist_dir: match dist.as_ref() {
        None => self
          .default_target_options
          .dist_dir
          .clone()
          .unwrap_or_else(|| self.default_dist_dir(&package_path).join(target_name)),
        Some(target_dist) => {
          let package_dir = package_path.parent().unwrap_or_else(|| &package_path);
          let dir = target_dist
            .parent()
            .map(|dir| dir.strip_prefix("./").ok().unwrap_or(dir))
            .and_then(|dir| {
              if dir == PathBuf::from("") {
                None
              } else {
                Some(dir)
              }
            });

          match dir {
            None => PathBuf::from(package_dir),
            Some(dir) => {
              println!("got a dir {}", dir.display());
              package_dir.join(dir)
            }
          }
        }
      },
      dist_entry: target_descriptor.dist_entry.clone().or_else(|| {
        dist
          .as_ref()
          .and_then(|d| d.file_name().map(|f| PathBuf::from(f)))
      }),
      env: Environment {
        context,
        engines: target_descriptor
          .engines
          .clone()
          .or_else(|| package_json.engines.clone())
          .unwrap_or_else(|| self.default_target_options.engines.clone()),
        include_node_modules: target_descriptor
          .include_node_modules
          .unwrap_or_else(|| IncludeNodeModules::from(context)),
        is_library,
        loc: None, // TODO
        output_format,
        should_optimize: self.default_target_options.should_optimize
          && if is_library {
            // Libraries are not optimized by default, users must explicitly configure this.
            target_descriptor.optimize.is_some_and(|o| o == true)
          } else {
            target_descriptor.optimize.is_none()
              || target_descriptor.optimize.is_some_and(|o| o != false)
          },
        should_scope_hoist: (is_library || self.default_target_options.should_scope_hoist)
          && (target_descriptor.scope_hoist.is_none()
            || target_descriptor.scope_hoist.is_some_and(|s| s != false)),
        source_map: match self.default_target_options.source_maps {
          false => None,
          true => target_descriptor.source_map.as_ref().and_then(|s| match s {
            SourceMapField::Bool(source_maps) => {
              source_maps.then(|| TargetSourceMapOptions::default())
            }
            SourceMapField::Options(source_maps) => Some(source_maps.clone()),
          }),
        },
        ..Environment::default()
      },
      loc: None, // TODO
      name: String::from(target_name),
      public_url: target_descriptor
        .public_url
        .clone()
        .unwrap_or(self.default_target_options.public_url.clone()),
    }))
  }
}

fn fallback_output_format(context: EnvironmentContext) -> OutputFormat {
  match context {
    EnvironmentContext::Node => OutputFormat::CommonJS,
    EnvironmentContext::ElectronMain => OutputFormat::CommonJS,
    EnvironmentContext::ElectronRenderer => OutputFormat::CommonJS,
    _ => OutputFormat::Global,
  }
}

impl Request for TargetRequest {
  fn run(
    &self,
    request_context: RunRequestContext,
  ) -> Result<ResultAndInvalidations, RunRequestError> {
    // TODO options.targets, should this still be supported?
    // TODO serve options
    let package_targets = self.resolve_package_targets(request_context)?;

    Ok(ResultAndInvalidations {
      invalidations: Vec::new(),
      result: RequestResult::Target(Targets(
        package_targets
          .into_iter()
          .filter_map(std::convert::identity)
          .collect(),
      )),
    })
  }
}

// TODO Add more tests when revisiting targets config structure
#[cfg(test)]
mod tests {
  use std::{num::NonZeroU16, path::PathBuf, sync::Arc};

  use parcel_core::types::{browsers::Browsers, version::Version};
  use parcel_filesystem::in_memory_file_system::InMemoryFileSystem;

  use crate::test_utils::{request_tracker, RequestTrackerTestOptions};

  use super::*;

  const BUILT_IN_TARGETS: [&str; 4] = ["browser", "main", "module", "types"];

  fn default_target() -> Target {
    Target {
      dist_dir: PathBuf::from("packages/test/dist"),
      env: Environment {
        output_format: OutputFormat::Global,
        ..Environment::default()
      },
      name: String::from("default"),
      ..Target::default()
    }
  }

  fn package_dir() -> PathBuf {
    PathBuf::from("packages").join("test")
  }

  fn targets_from_package_json(package_json: String) -> Result<RequestResult, anyhow::Error> {
    let fs = InMemoryFileSystem::default();
    let project_root = PathBuf::default();
    let package_dir = package_dir();

    fs.write_file(
      &project_root.join(&package_dir).join("package.json"),
      package_json,
    );

    let request = TargetRequest {
      default_target_options: DefaultTargetOptions::default(),
      env: None,
      exclusive_target: None,
      mode: BuildMode::Development,
    };

    request_tracker(RequestTrackerTestOptions {
      search_path: project_root.join(&package_dir),
      project_root,
      fs: Arc::new(fs),
      ..Default::default()
    })
    .run_request(request)
  }

  #[test]
  fn returns_error_when_builtin_target_is_true() {
    for builtin_target in BUILT_IN_TARGETS {
      let targets = targets_from_package_json(format!(
        r#"{{ "targets": {{ "{}": true }} }}"#,
        builtin_target,
      ));

      assert!(targets
        .map_err(|e| e.to_string())
        .unwrap_err()
        .starts_with("data did not match any variant"));
    }
  }

  #[test]
  fn returns_error_when_builtin_target_does_not_reference_expected_extension() {
    for builtin_target in BUILT_IN_TARGETS {
      let targets =
        targets_from_package_json(format!(r#"{{ "{}": "dist/main.rs" }}"#, builtin_target,));

      assert_eq!(
        targets.map_err(|e| e.to_string()),
        Err(format!(
          "Unexpected file type \"main.rs\" in \"{}\" target",
          builtin_target
        ))
      );
    }
  }

  #[test]
  fn returns_error_when_scope_hoisting_disabled_for_library_targets() {
    let assert_error = |name, package_json| {
      let targets = targets_from_package_json(package_json);

      assert_eq!(
        targets.map_err(|e| e.to_string()),
        Err(format!(
          "Scope hoisting cannot be disabled for \"{}\" library target",
          name
        ))
      );
    };

    for builtin_target in BUILT_IN_TARGETS {
      assert_error(
        builtin_target,
        format!(
          r#"
            {{
              "{}": "dist/target.{}",
              "targets": {{
                "{}": {{
                  "isLibrary": true,
                  "scopeHoist": false
                }}
              }}
            }}
          "#,
          builtin_target,
          if builtin_target == "types" {
            "ts"
          } else {
            "js"
          },
          builtin_target,
        ),
      );
    }

    assert_error(
      "custom",
      String::from(
        r#"
          {
            "targets": {
              "custom": {
                "isLibrary": true,
                "scopeHoist": false
              }
            }
          }
        "#,
      ),
    );
  }

  #[test]
  fn returns_default_target_when_builtin_targets_are_disabled() {
    for builtin_target in BUILT_IN_TARGETS {
      let targets = targets_from_package_json(format!(
        r#"{{ "targets": {{ "{}": false }} }}"#,
        builtin_target,
      ));

      assert_eq!(
        targets.map_err(|e| e.to_string()),
        Ok(RequestResult::Target(Targets(vec![default_target()])),)
      );
    }
  }

  #[test]
  fn returns_default_target_when_no_targets_are_specified() {
    let targets = targets_from_package_json(String::from("{}"));

    assert_eq!(
      targets.map_err(|e| e.to_string()),
      Ok(RequestResult::Target(Targets(vec![default_target()])),)
    );
  }

  fn builtin_default_env() -> Environment {
    Environment {
      include_node_modules: IncludeNodeModules::Bool(false),
      is_library: true,
      should_optimize: false,
      should_scope_hoist: true,
      ..Environment::default()
    }
  }

  #[test]
  fn returns_builtin_browser_target() {
    let targets = targets_from_package_json(String::from(r#"{ "browser": "build/browser.js" }"#));

    assert_eq!(
      targets.map_err(|e| e.to_string()),
      Ok(RequestResult::Target(Targets(vec![Target {
        dist_dir: package_dir().join("build"),
        dist_entry: Some(PathBuf::from("browser.js")),
        env: Environment {
          context: EnvironmentContext::Browser,
          output_format: OutputFormat::CommonJS,
          ..builtin_default_env()
        },
        name: String::from("browser"),
        ..Target::default()
      },])),)
    );
  }

  #[test]
  fn returns_builtin_main_target() {
    let targets = targets_from_package_json(String::from(r#"{ "main": "./build/main.js" }"#));

    assert_eq!(
      targets.map_err(|e| e.to_string()),
      Ok(RequestResult::Target(Targets(vec![Target {
        dist_dir: package_dir().join("build"),
        dist_entry: Some(PathBuf::from("main.js")),
        env: Environment {
          context: EnvironmentContext::Node,
          output_format: OutputFormat::CommonJS,
          ..builtin_default_env()
        },
        name: String::from("main"),
        ..Target::default()
      },])),)
    );
  }

  #[test]
  fn returns_builtin_module_target() {
    let targets = targets_from_package_json(String::from(r#"{ "module": "module.js" }"#));

    assert_eq!(
      targets.map_err(|e| e.to_string()),
      Ok(RequestResult::Target(Targets(vec![Target {
        dist_dir: package_dir(),
        dist_entry: Some(PathBuf::from("module.js")),
        env: Environment {
          context: EnvironmentContext::Node,
          output_format: OutputFormat::EsModule,
          ..builtin_default_env()
        },
        name: String::from("module"),
        ..Target::default()
      },])),)
    );
  }

  #[test]
  fn returns_builtin_types_target() {
    let targets = targets_from_package_json(String::from(r#"{ "types": "./types.d.ts" }"#));

    assert_eq!(
      targets.map_err(|e| e.to_string()),
      Ok(RequestResult::Target(Targets(vec![Target {
        dist_dir: package_dir(),
        dist_entry: Some(PathBuf::from("types.d.ts")),
        env: Environment {
          context: EnvironmentContext::Node,
          output_format: OutputFormat::CommonJS,
          ..builtin_default_env()
        },
        name: String::from("types"),
        ..Target::default()
      },])),)
    );
  }

  #[test]
  fn returns_builtin_targets() {
    let targets = targets_from_package_json(String::from(
      r#"
        {
          "browser": "build/browser.js",
          "main": "./build/main.js",
          "module": "module.js",
          "types": "./types.d.ts",
          "browserslist": ["chrome 20"]
        }
      "#,
    ));

    let env = || Environment {
      engines: Engines {
        browsers: Browsers {
          chrome: Some(Version::new(NonZeroU16::new(20).unwrap(), 0)),
          ..Browsers::default()
        },
        ..Engines::default()
      },
      ..builtin_default_env()
    };

    let package_dir = package_dir();

    assert_eq!(
      targets.map_err(|e| e.to_string()),
      Ok(RequestResult::Target(Targets(vec![
        Target {
          dist_dir: package_dir.join("build"),
          dist_entry: Some(PathBuf::from("browser.js")),
          env: Environment {
            context: EnvironmentContext::Browser,
            output_format: OutputFormat::CommonJS,
            ..env()
          },
          name: String::from("browser"),
          ..Target::default()
        },
        Target {
          dist_dir: package_dir.join("build"),
          dist_entry: Some(PathBuf::from("main.js")),
          env: Environment {
            context: EnvironmentContext::Node,
            output_format: OutputFormat::CommonJS,
            ..env()
          },
          name: String::from("main"),
          ..Target::default()
        },
        Target {
          dist_dir: package_dir.clone(),
          dist_entry: Some(PathBuf::from("module.js")),
          env: Environment {
            context: EnvironmentContext::Node,
            output_format: OutputFormat::EsModule,
            ..env()
          },
          name: String::from("module"),
          ..Target::default()
        },
        Target {
          dist_dir: package_dir,
          dist_entry: Some(PathBuf::from("types.d.ts")),
          env: Environment {
            context: EnvironmentContext::Node,
            output_format: OutputFormat::CommonJS,
            ..env()
          },
          name: String::from("types"),
          ..Target::default()
        },
      ])),)
    );
  }

  #[test]
  fn returns_custom_targets_with_defaults() {
    let targets = targets_from_package_json(String::from(r#"{ "targets": { "custom": {} } } "#));

    assert_eq!(
      targets.map_err(|e| e.to_string()),
      Ok(RequestResult::Target(Targets(vec![Target {
        dist_dir: package_dir().join("dist").join("custom"),
        dist_entry: None,
        env: Environment {
          context: EnvironmentContext::Browser,
          is_library: false,
          output_format: OutputFormat::Global,
          should_optimize: false,
          should_scope_hoist: false,
          ..Environment::default()
        },
        name: String::from("custom"),
        ..Target::default()
      },])),)
    );
  }

  #[test]
  fn returns_custom_targets() {
    let targets = targets_from_package_json(String::from(
      r#"
        {
          "custom": "dist/custom.js",
          "targets": {
            "custom": {
              "context": "node",
              "includeNodeModules": true,
              "outputFormat": "commonjs"
            }
          }
        }
      "#,
    ));

    assert_eq!(
      targets.map_err(|e| e.to_string()),
      Ok(RequestResult::Target(Targets(vec![Target {
        dist_dir: package_dir().join("dist"),
        dist_entry: Some(PathBuf::from("custom.js")),
        env: Environment {
          context: EnvironmentContext::Node,
          include_node_modules: IncludeNodeModules::Bool(true),
          is_library: false,
          output_format: OutputFormat::CommonJS,
          ..Environment::default()
        },
        name: String::from("custom"),
        ..Target::default()
      },])),)
    );
  }

  #[test]
  fn returns_inferred_custom_browser_target() {
    let targets = targets_from_package_json(String::from(
      r#"
        {
          "custom": "dist/custom.js",
          "browserslist": ["chrome 20", "firefox > 1"],
          "targets": {
            "custom": {}
          }
        }
      "#,
    ));

    assert_eq!(
      targets.map_err(|e| e.to_string()),
      Ok(RequestResult::Target(Targets(vec![Target {
        dist_dir: package_dir().join("dist"),
        dist_entry: Some(PathBuf::from("custom.js")),
        env: Environment {
          context: EnvironmentContext::Browser,
          engines: Engines {
            browsers: Browsers {
              chrome: Some(Version::new(NonZeroU16::new(20).unwrap(), 0)),
              firefox: Some(Version::new(NonZeroU16::new(2).unwrap(), 0)),
              ..Browsers::default()
            },
            ..Engines::default()
          },
          include_node_modules: IncludeNodeModules::Bool(true),
          output_format: OutputFormat::Global,
          ..Environment::default()
        },
        name: String::from("custom"),
        ..Target::default()
      },])),)
    );
  }

  #[test]
  fn returns_inferred_custom_node_target() {
    let assert_targets = |targets: Result<RequestResult, anyhow::Error>, engines| {
      assert_eq!(
        targets.map_err(|e| e.to_string()),
        Ok(RequestResult::Target(Targets(vec![Target {
          dist_dir: package_dir().join("dist"),
          dist_entry: Some(PathBuf::from("custom.js")),
          env: Environment {
            context: EnvironmentContext::Node,
            engines,
            include_node_modules: IncludeNodeModules::Bool(false),
            output_format: OutputFormat::CommonJS,
            ..Environment::default()
          },
          name: String::from("custom"),
          ..Target::default()
        },])),)
      );
    };

    assert_targets(
      targets_from_package_json(String::from(
        r#"
          {
            "custom": "dist/custom.js",
            "engines": { "node": "^1.0.0" },
            "targets": { "custom": {} }
          }
        "#,
      )),
      Engines {
        node: Some(Version::new(NonZeroU16::new(1).unwrap(), 0)),
        ..Engines::default()
      },
    );

    assert_targets(
      targets_from_package_json(String::from(
        r#"
          {
            "custom": "dist/custom.js",
            "engines": { "node": "^1.0.0" },
            "browserslist": ["chrome 20"],
            "targets": { "custom": {} }
          }
        "#,
      )),
      Engines {
        browsers: Browsers {
          chrome: Some(Version::new(NonZeroU16::new(20).unwrap(), 0)),
          ..Browsers::default()
        },
        node: Some(Version::new(NonZeroU16::new(1).unwrap(), 0)),
        ..Engines::default()
      },
    );
  }
}
