use std::collections::HashMap;
use std::hash::Hash;
use std::path::Path;
use std::path::PathBuf;

use package_json::BrowserField;
use package_json::BrowsersList;
use package_json::BuiltInTargetDescriptor;
use package_json::ModuleFormat;
use package_json::PackageJson;
use package_json::SourceField;
use package_json::SourceMapField;
use package_json::TargetDescriptor;
use parcel_core::config_loader::ConfigFile;
use parcel_core::diagnostic_error;
use parcel_core::types::engines::Engines;
use parcel_core::types::BuildMode;
use parcel_core::types::CodeFrame;
use parcel_core::types::DefaultTargetOptions;
use parcel_core::types::DiagnosticBuilder;
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

use super::entry_request::Entry;
use super::RequestResult;

mod package_json;

/// Infers how and where source code is outputted
///
/// Targets will be generated from the project package.json file and input Parcel options.
///
#[derive(Debug)]
pub struct TargetRequest {
  pub default_target_options: DefaultTargetOptions,
  pub entry: Entry,
  pub env: Option<HashMap<String, String>>,
  pub mode: BuildMode,
}

impl Hash for TargetRequest {
  fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
    self.default_target_options.hash(state);
    self.entry.hash(state);
    self.mode.hash(state);
  }
}

#[derive(Debug, Clone, PartialEq)]
pub struct TargetRequestOutput {
  pub entry: PathBuf,
  pub targets: Vec<Target>,
}

struct BuiltInTarget<'a> {
  descriptor: BuiltInTargetDescriptor,
  dist: Option<PathBuf>,
  name: &'a str,
}

struct CustomTarget<'a> {
  descriptor: &'a TargetDescriptor,
  name: &'a str,
}

impl TargetRequest {
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
          ..builtin_target_descriptor()
        })
      }),
      dist: dist.and_then(|browser| match browser {
        BrowserField::EntryPoint(entrypoint) => Some(entrypoint.clone()),
        BrowserField::ReplacementBySpecifier(replacements) => {
          name.and_then(|name| replacements.get(&name).map(|v| v.into()))
        }
      }),
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
          ..builtin_target_descriptor()
        })
      }),
      dist,
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
          ..builtin_target_descriptor()
        })
      }),
      dist,
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
          ..builtin_target_descriptor()
        })
      }),
      dist,
      name: "types",
    }
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
    dist_entry: &Option<PathBuf>,
    package_json: &ConfigFile<PackageJson>,
    target: &TargetDescriptor,
  ) -> Result<Option<OutputFormat>, anyhow::Error> {
    let ext = dist_entry
      .as_ref()
      .and_then(|e| e.extension())
      .unwrap_or_default()
      .to_str();

    let inferred_output_format = match ext {
      Some("cjs") => Some(OutputFormat::CommonJS),
      Some("mjs") => Some(OutputFormat::EsModule),
      Some("js") => package_json
        .contents
        .module_format
        .as_ref()
        .and_then(|format| match format {
          ModuleFormat::CommonJS => Some(OutputFormat::CommonJS),
          ModuleFormat::Module => Some(OutputFormat::EsModule),
        }),
      _ => None,
    };

    if let Some(inferred_output_format) = inferred_output_format {
      if let Some(output_format) = target.output_format {
        if output_format != inferred_output_format {
          return Err(diagnostic_error!(DiagnosticBuilder::default()
            .code_frames(vec![CodeFrame::from(package_json)])
            .message(format!(
              "Declared output format {output_format} does not match expected output format {inferred_output_format}",
            ))));
        }
      }
    }

    Ok(inferred_output_format)
  }

  fn load_package_json(
    &self,
    request_context: RunRequestContext,
  ) -> Result<ConfigFile<PackageJson>, anyhow::Error> {
    // TODO Invalidations
    let mut package_json = request_context
      .config()
      .load_package_json::<PackageJson>()?;

    if package_json
      .contents
      .engines
      .as_ref()
      .is_some_and(|e| !e.browsers.is_empty())
    {
      return Ok(package_json);
    }

    let env = self
      .env
      .as_ref()
      .and_then(|env| env.get("BROWSERSLIST_ENV").or_else(|| env.get("NODE_ENV")))
      .map(|e| e.to_owned())
      .unwrap_or_else(|| self.mode.to_string());

    match package_json.contents.browserslist.clone() {
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

        package_json.contents.engines = Some(Engines {
          browsers: Engines::from_browserslist(browserslist),
          ..match package_json.contents.engines {
            None => Engines::default(),
            Some(engines) => engines,
          }
        });
      }
    };

    Ok(package_json)
  }

  fn resolve_package_targets(
    &self,
    request_context: RunRequestContext,
  ) -> Result<Vec<Option<Target>>, anyhow::Error> {
    let package_json = self.load_package_json(request_context)?;
    let mut targets: Vec<Option<Target>> = Vec::new();

    let builtin_targets = [
      self.builtin_browser_target(
        package_json.contents.targets.browser.clone(),
        package_json.contents.browser.clone(),
        package_json.contents.name.clone(),
      ),
      self.builtin_main_target(
        package_json.contents.targets.main.clone(),
        package_json.contents.main.clone(),
      ),
      self.builtin_module_target(
        package_json.contents.targets.module.clone(),
        package_json.contents.module.clone(),
      ),
      self.builtin_types_target(
        package_json.contents.targets.types.clone(),
        package_json.contents.types.clone(),
      ),
    ];

    for builtin_target in builtin_targets {
      if builtin_target.dist.is_none() {
        continue;
      }

      match builtin_target.descriptor {
        BuiltInTargetDescriptor::Disabled(_disabled) => continue,
        BuiltInTargetDescriptor::TargetDescriptor(builtin_target_descriptor) => {
          targets.push(self.target_from_descriptor(
            builtin_target.dist,
            &package_json,
            builtin_target_descriptor,
            builtin_target.name,
          )?);
        }
      }
    }

    let custom_targets = package_json
      .contents
      .targets
      .custom_targets
      .iter()
      .map(|(name, descriptor)| CustomTarget { descriptor, name });

    for custom_target in custom_targets {
      let mut dist = None;
      if let Some(value) = package_json.contents.fields.get(custom_target.name) {
        match value {
          serde_json::Value::String(str) => {
            dist = Some(PathBuf::from(str));
          }
          _ => {
            return Err(diagnostic_error!(DiagnosticBuilder::default()
              .code_frames(vec![CodeFrame::from(&package_json)])
              .message(format!("Invalid path for target {}", custom_target.name))));
          }
        }
      }

      targets.push(self.target_from_descriptor(
        dist,
        &package_json,
        custom_target.descriptor.clone(),
        &custom_target.name,
      )?);
    }

    if targets.is_empty() {
      let context = self.infer_environment_context(&package_json.contents);

      targets.push(Some(Target {
        dist_dir: self
          .default_target_options
          .dist_dir
          .clone()
          .unwrap_or_else(|| default_dist_dir(&package_json.path)),
        dist_entry: None,
        env: Environment {
          context,
          engines: package_json
            .contents
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

  fn skip_target(&self, target_name: &str, source: &Option<SourceField>) -> bool {
    // We skip targets if they have a descriptor.source that does not match the current
    // exclusiveTarget. They will be handled by a separate resolvePackageTargets call from their
    // Entry point but with exclusiveTarget set.
    match self.entry.target.as_ref() {
      None => source.is_some(),
      Some(exclusive_target) => target_name != exclusive_target,
    }
  }

  fn target_from_descriptor(
    &self,
    dist: Option<PathBuf>,
    package_json: &ConfigFile<PackageJson>,
    target_descriptor: TargetDescriptor,
    target_name: &str,
  ) -> Result<Option<Target>, anyhow::Error> {
    if self.skip_target(&target_name, &target_descriptor.source) {
      return Ok(None);
    }

    // TODO LOC
    let context = target_descriptor
      .context
      .unwrap_or_else(|| self.infer_environment_context(&package_json.contents));

    let dist_entry = target_descriptor.dist_entry.clone().or_else(|| {
      dist
        .as_ref()
        .and_then(|d| d.file_name().map(|f| PathBuf::from(f)))
    });

    let inferred_output_format =
      self.infer_output_format(&dist_entry, &package_json, &target_descriptor)?;

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
      return Err(diagnostic_error!(DiagnosticBuilder::default()
        .code_frames(vec![CodeFrame::from(package_json)])
        .message("Output format \"esmodule\" cannot be used in the \"main\" target without a .mjs extension or \"type\": \"module\" field")));
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
          .unwrap_or_else(|| default_dist_dir(&package_json.path).join(target_name)),
        Some(target_dist) => {
          let package_dir = package_json
            .path
            .parent()
            .unwrap_or_else(|| &package_json.path);
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
            Some(dir) => package_dir.join(dir),
          }
        }
      },
      dist_entry,
      env: Environment {
        context,
        engines: target_descriptor
          .engines
          .clone()
          .or_else(|| package_json.contents.engines.clone())
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

fn builtin_target_descriptor() -> TargetDescriptor {
  TargetDescriptor {
    include_node_modules: Some(IncludeNodeModules::Bool(false)),
    is_library: Some(true),
    scope_hoist: Some(true),
    ..TargetDescriptor::default()
  }
}

fn default_dist_dir(package_path: &Path) -> PathBuf {
  package_path
    .parent()
    .unwrap_or_else(|| &package_path)
    .join("dist")
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
      result: RequestResult::Target(TargetRequestOutput {
        entry: self.entry.file_path.clone(),
        targets: package_targets
          .into_iter()
          .filter_map(std::convert::identity)
          .collect(),
      }),
    })
  }
}

// TODO Add more tests when revisiting targets config structure
#[cfg(test)]
mod tests {
  use std::{num::NonZeroU16, sync::Arc};

  use regex::Regex;

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
      entry: Entry::default(),
      env: None,
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

  fn to_deterministic_error(error: anyhow::Error) -> String {
    let re = Regex::new(r"\d+").unwrap();
    re.replace_all(&format!("{:#}", error), "\\d").into_owned()
  }

  #[test]
  fn returns_error_when_builtin_target_is_true() {
    for builtin_target in BUILT_IN_TARGETS {
      let targets = targets_from_package_json(format!(
        r#"{{ "targets": {{ "{builtin_target}": true }} }}"#,
      ));

      assert_eq!(
        targets.map_err(to_deterministic_error),
        Err(format!("data did not match any variant of untagged enum BuiltInTargetDescriptor at line \\d column \\d in {}",
          package_dir().join("package.json").display()
        ))
      );
    }
  }

  #[test]
  fn returns_error_when_builtin_target_does_not_reference_expected_extension() {
    for builtin_target in BUILT_IN_TARGETS {
      let targets =
        targets_from_package_json(format!(r#"{{ "{}": "dist/main.rs" }}"#, builtin_target));

      assert_eq!(
        targets.map_err(to_deterministic_error),
        Err(format!(
          "Unexpected file type \"main.rs\" in \"{}\" target at line \\d column \\d in {}",
          builtin_target,
          package_dir().join("package.json").display()
        ))
      );
    }
  }

  #[test]
  fn returns_error_when_builtin_target_has_global_output_format() {
    for builtin_target in BUILT_IN_TARGETS {
      let targets = targets_from_package_json(format!(
        r#"{{
          "targets": {{
            "{builtin_target}": {{ "outputFormat": "global" }}
          }}
        }}"#
      ));

      assert_eq!(
        targets.map_err(to_deterministic_error),
        Err(format!(
          "The \"global\" output format is not supported in the {} target at line \\d column \\d in {}",
          builtin_target,
          package_dir().join("package.json").display()
        ))
      );
    }
  }

  #[test]
  fn returns_error_when_output_format_does_not_match_inferred_output_format() {
    let assert_error = |ext, module_format: Option<&str>, output_format| {
      let targets = targets_from_package_json(format!(
        r#"
          {{
            {}
            "custom": "dist/custom.{ext}",
            "targets": {{
              "custom": {{
                "outputFormat": "{output_format}"
              }}
            }}
          }}
        "#,
        module_format.map_or_else(
          || String::default(),
          |module_format| format!(r#""type": "{module_format}","#)
        ),
      ));

      assert_eq!(
        targets.map_err(|err| err.to_string()),
        Err(format!(
          "Declared output format {output_format} does not match expected output format {}",
          if output_format == OutputFormat::CommonJS {
            "esmodule"
          } else {
            "commonjs"
          }
        ))
      );
    };

    assert_error("cjs", None, OutputFormat::EsModule);
    assert_error("cjs", Some("module"), OutputFormat::EsModule);

    assert_error("js", Some("commonjs"), OutputFormat::EsModule);
    assert_error("js", Some("module"), OutputFormat::CommonJS);

    assert_error("mjs", None, OutputFormat::CommonJS);
    assert_error("mjs", Some("commonjs"), OutputFormat::CommonJS);
  }

  #[test]
  fn returns_error_when_scope_hoisting_disabled_for_library_targets() {
    let assert_error = |name, package_json| {
      let targets = targets_from_package_json(package_json);

      assert_eq!(
        targets.map_err(to_deterministic_error),
        Err(format!(
          "Scope hoisting cannot be disabled for \"{}\" library target at line \\d column \\d in {}",
          name,
          package_dir().join("package.json").display()
        ))
      );
    };

    for target in BUILT_IN_TARGETS {
      assert_error(
        target,
        format!(
          r#"
            {{
              "{target}": "dist/target.{ext}",
              "targets": {{
                "{target}": {{
                  "isLibrary": true,
                  "scopeHoist": false
                }}
              }}
            }}
          "#,
          ext = if target == "types" { "ts" } else { "js" },
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
        r#"{{ "targets": {{ "{builtin_target}": false }} }}"#
      ));

      assert_eq!(
        targets.map_err(|e| e.to_string()),
        Ok(RequestResult::Target(TargetRequestOutput {
          entry: PathBuf::default(),
          targets: vec![default_target()]
        }))
      );
    }
  }

  #[test]
  fn returns_default_target_when_no_targets_are_specified() {
    let targets = targets_from_package_json(String::from("{}"));

    assert_eq!(
      targets.map_err(|e| e.to_string()),
      Ok(RequestResult::Target(TargetRequestOutput {
        entry: PathBuf::default(),
        targets: vec![default_target()]
      }))
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
      Ok(RequestResult::Target(TargetRequestOutput {
        entry: PathBuf::default(),
        targets: vec![Target {
          dist_dir: package_dir().join("build"),
          dist_entry: Some(PathBuf::from("browser.js")),
          env: Environment {
            context: EnvironmentContext::Browser,
            output_format: OutputFormat::CommonJS,
            ..builtin_default_env()
          },
          name: String::from("browser"),
          ..Target::default()
        }]
      }))
    );
  }

  #[test]
  fn returns_builtin_main_target() {
    let targets = targets_from_package_json(String::from(r#"{ "main": "./build/main.js" }"#));

    assert_eq!(
      targets.map_err(|e| e.to_string()),
      Ok(RequestResult::Target(TargetRequestOutput {
        entry: PathBuf::default(),
        targets: vec![Target {
          dist_dir: package_dir().join("build"),
          dist_entry: Some(PathBuf::from("main.js")),
          env: Environment {
            context: EnvironmentContext::Node,
            output_format: OutputFormat::CommonJS,
            ..builtin_default_env()
          },
          name: String::from("main"),
          ..Target::default()
        }]
      }))
    );
  }

  #[test]
  fn returns_builtin_module_target() {
    let targets = targets_from_package_json(String::from(r#"{ "module": "module.js" }"#));

    assert_eq!(
      targets.map_err(|e| e.to_string()),
      Ok(RequestResult::Target(TargetRequestOutput {
        entry: PathBuf::default(),
        targets: vec![Target {
          dist_dir: package_dir(),
          dist_entry: Some(PathBuf::from("module.js")),
          env: Environment {
            context: EnvironmentContext::Node,
            output_format: OutputFormat::EsModule,
            ..builtin_default_env()
          },
          name: String::from("module"),
          ..Target::default()
        }]
      }))
    );
  }

  #[test]
  fn returns_builtin_types_target() {
    let targets = targets_from_package_json(String::from(r#"{ "types": "./types.d.ts" }"#));

    assert_eq!(
      targets.map_err(|e| e.to_string()),
      Ok(RequestResult::Target(TargetRequestOutput {
        entry: PathBuf::default(),
        targets: vec![Target {
          dist_dir: package_dir(),
          dist_entry: Some(PathBuf::from("types.d.ts")),
          env: Environment {
            context: EnvironmentContext::Node,
            output_format: OutputFormat::CommonJS,
            ..builtin_default_env()
          },
          name: String::from("types"),
          ..Target::default()
        }]
      }))
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
      Ok(RequestResult::Target(TargetRequestOutput {
        entry: PathBuf::default(),
        targets: vec![
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
        ]
      }))
    );
  }

  #[test]
  fn returns_custom_targets_with_defaults() {
    let targets = targets_from_package_json(String::from(r#"{ "targets": { "custom": {} } } "#));

    assert_eq!(
      targets.map_err(|e| e.to_string()),
      Ok(RequestResult::Target(TargetRequestOutput {
        entry: PathBuf::default(),
        targets: vec![Target {
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
        }]
      }))
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
      Ok(RequestResult::Target(TargetRequestOutput {
        entry: PathBuf::default(),
        targets: vec![Target {
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
        }]
      }))
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
      Ok(RequestResult::Target(TargetRequestOutput {
        entry: PathBuf::default(),
        targets: vec![Target {
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
        }]
      }))
    );
  }

  #[test]
  fn returns_inferred_custom_node_target() {
    let assert_targets = |targets: Result<RequestResult, anyhow::Error>, engines| {
      assert_eq!(
        targets.map_err(|e| e.to_string()),
        Ok(RequestResult::Target(TargetRequestOutput {
          entry: PathBuf::default(),
          targets: vec![Target {
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
          }]
        }))
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

  #[test]
  fn returns_custom_target_when_output_format_matches_inferred_output_format() {
    let assert_targets = |ext, module_format: Option<ModuleFormat>, output_format| {
      let targets = targets_from_package_json(format!(
        r#"
          {{
            {}
            "custom": "dist/custom.{ext}",
            "targets": {{
              "custom": {{
                "outputFormat": "{output_format}"
              }}
            }}
          }}
        "#,
        module_format.map_or_else(
          || String::default(),
          |module_format| format!(r#""type": "{module_format}","#)
        ),
      ));

      assert_eq!(
        targets.map_err(|e| e.to_string()),
        Ok(RequestResult::Target(TargetRequestOutput {
          entry: PathBuf::default(),
          targets: vec![Target {
            dist_dir: package_dir().join("dist"),
            dist_entry: Some(PathBuf::from(format!("custom.{ext}"))),
            env: Environment {
              output_format,
              ..Environment::default()
            },
            name: String::from("custom"),
            ..Target::default()
          }],
        }))
      );
    };

    assert_targets("cjs", None, OutputFormat::CommonJS);
    assert_targets("cjs", Some(ModuleFormat::CommonJS), OutputFormat::CommonJS);
    assert_targets("cjs", Some(ModuleFormat::Module), OutputFormat::CommonJS);

    assert_targets("js", None, OutputFormat::CommonJS);
    assert_targets("js", Some(ModuleFormat::CommonJS), OutputFormat::CommonJS);

    assert_targets("js", None, OutputFormat::EsModule);
    assert_targets("js", Some(ModuleFormat::Module), OutputFormat::EsModule);

    assert_targets("mjs", None, OutputFormat::EsModule);
    assert_targets("mjs", Some(ModuleFormat::CommonJS), OutputFormat::EsModule);
    assert_targets("mjs", Some(ModuleFormat::Module), OutputFormat::EsModule);
  }
}
