use std::path::Path;
use std::path::PathBuf;

use parcel_core::diagnostic_error;
use parcel_core::types::CodeFrame;
use parcel_core::types::CodeHighlight;
use parcel_core::types::DiagnosticBuilder;
use parcel_core::types::DiagnosticError;
use parcel_core::types::File;
use parcel_filesystem::search::find_ancestor_file;
use parcel_filesystem::FileSystemRef;
use parcel_package_manager::PackageManagerRef;
use pathdiff::diff_paths;
use serde_json5::Location;

use super::parcel_config::ParcelConfig;
use super::parcel_config::PluginNode;
use super::parcel_rc::Extends;
use super::parcel_rc::ParcelRcFile;
use super::partial_parcel_config::PartialParcelConfig;

#[derive(Default)]
pub struct LoadConfigOptions<'a> {
  /// A list of additional reporter plugins that will be appended to the reporters config
  pub additional_reporters: Vec<PluginNode>,
  /// A file path or package specifier that will be used to load the config from
  pub config: Option<&'a str>,
  /// A file path or package specifier that will be used to load the config from when no other
  /// .parcelrc can be found
  pub fallback_config: Option<&'a str>,
}

/// Loads and validates .parcel_rc config
pub struct ParcelRcConfigLoader {
  fs: FileSystemRef,
  package_manager: PackageManagerRef,
}

impl ParcelRcConfigLoader {
  pub fn new(fs: FileSystemRef, package_manager: PackageManagerRef) -> Self {
    ParcelRcConfigLoader {
      fs,
      package_manager,
    }
  }

  fn find_config(&self, project_root: &Path, path: &Path) -> Result<PathBuf, DiagnosticError> {
    let from = path.parent().unwrap_or(path);

    find_ancestor_file(&*self.fs, &[".parcelrc"], from, project_root)
      .ok_or_else(|| diagnostic_error!("Unable to locate .parcelrc from {}", from.display()))
  }

  fn resolve_from(&self, project_root: &Path) -> PathBuf {
    let cwd = self.fs.cwd().unwrap();
    let relative = diff_paths(cwd.clone(), project_root);
    let is_cwd_inside_project_root =
      relative.is_some_and(|p| !p.starts_with("..") && !p.is_absolute());

    let dir = if is_cwd_inside_project_root {
      &cwd
    } else {
      project_root
    };

    dir.join("index")
  }

  fn load_config(
    &self,
    path: PathBuf,
  ) -> Result<(PartialParcelConfig, Vec<PathBuf>), DiagnosticError> {
    let raw = self.fs.read_to_string(&path).map_err(|source| {
      diagnostic_error!(DiagnosticBuilder::default()
        .message(source.to_string())
        .code_frames(vec![CodeFrame::from(path.clone())]))
    })?;

    let contents = serde_json5::from_str(&raw).map_err(|error| {
      serde_to_diagnostic_error(
        error,
        File {
          contents: raw.clone(),
          path: path.clone(),
        },
      )
    })?;

    self.process_config(ParcelRcFile {
      contents,
      path,
      raw,
    })
  }

  fn resolve_extends(
    &self,
    parcel_rc_file: &ParcelRcFile,
    extend: &str,
  ) -> Result<PathBuf, DiagnosticError> {
    let path = if extend.starts_with(".") {
      parcel_rc_file
        .path
        .parent()
        .unwrap_or(&parcel_rc_file.path)
        .join(extend)
    } else {
      self
        .package_manager
        .resolve(extend, &parcel_rc_file.path)
        .map_err(|source| {
          source.context(diagnostic_error!(DiagnosticBuilder::default()
            .message(format!(
              "Failed to resolve extended config {extend} from {}",
              parcel_rc_file.path.display()
            ))
            .code_frames(vec![CodeFrame::from(File::from(parcel_rc_file))])))
        })?
        .resolved
    };

    self.fs.canonicalize_base(&path).map_err(|source| {
      diagnostic_error!("{}", source).context(diagnostic_error!(DiagnosticBuilder::default()
        .message(format!(
          "Failed to resolve extended config {extend} from {}",
          parcel_rc_file.path.display()
        ))
        .code_frames(vec![CodeFrame::from(File::from(parcel_rc_file))])))
    })
  }

  /// Processes a .parcelrc file by loading and merging "extends" configurations into a single
  /// PartialParcelConfig struct
  ///
  /// Configuration merging will be applied to all "extends" configurations, before being merged
  /// into the base config for a more natural merging order. It will replace any "..." seen in
  /// plugin pipelines with the corresponding plugins from "extends" if present.
  ///
  fn process_config(
    &self,
    parcel_rc_file: ParcelRcFile,
  ) -> Result<(PartialParcelConfig, Vec<PathBuf>), DiagnosticError> {
    let mut files = vec![parcel_rc_file.path.clone()];
    let extends = parcel_rc_file.contents.extends.as_ref();
    let extends = match extends {
      None => Vec::new(),
      Some(extends) => match extends {
        Extends::One(ext) => vec![String::from(ext)],
        Extends::Many(ext) => ext.to_vec(),
      },
    };

    if extends.is_empty() {
      return Ok((PartialParcelConfig::try_from(parcel_rc_file)?, files));
    }

    let mut merged_config: Option<PartialParcelConfig> = None;
    for extend in extends {
      let extended_file_path = self.resolve_extends(&parcel_rc_file, &extend)?;
      let (extended_config, mut extended_file_paths) = self.load_config(extended_file_path)?;

      merged_config = match merged_config {
        None => Some(extended_config),
        Some(config) => Some(PartialParcelConfig::merge(config, extended_config)),
      };

      files.append(&mut extended_file_paths);
    }

    let config = PartialParcelConfig::merge(
      PartialParcelConfig::try_from(parcel_rc_file)?,
      merged_config.unwrap(),
    );

    Ok((config, files))
  }

  /// Finds and loads a .parcelrc file
  ///
  /// By default the nearest .parcelrc ancestor file from the current working directory will be
  /// loaded, unless the config or fallback_config option are specified. In cases where the
  /// current working directory does not live within the project root, the default config will be
  /// loaded from the project root.
  ///
  pub fn load(
    &self,
    project_root: &Path,
    options: LoadConfigOptions,
  ) -> Result<(ParcelConfig, Vec<PathBuf>), DiagnosticError> {
    let resolve_from = self.resolve_from(project_root);
    let mut config_path = match options.config {
      Some(config) => self
        .package_manager
        .resolve(&config, &resolve_from)
        .map(|r| r.resolved)
        .map_err(|source| {
          source.context(diagnostic_error!(
            "Failed to resolve config {config} from {}",
            resolve_from.display()
          ))
        }),
      None => self.find_config(project_root, &resolve_from),
    };

    if !config_path.is_ok() {
      if let Some(fallback_config) = options.fallback_config {
        config_path = self
          .package_manager
          .resolve(&fallback_config, &resolve_from)
          .map(|r| r.resolved)
          .map_err(|source| {
            source.context(diagnostic_error!(
              "Failed to resolve fallback {fallback_config} from {}",
              resolve_from.display()
            ))
          })
      }
    }

    let config_path = config_path?;
    let (mut parcel_config, files) = self.load_config(config_path)?;

    if options.additional_reporters.len() > 0 {
      parcel_config.reporters.extend(options.additional_reporters);
    }

    let parcel_config = ParcelConfig::try_from(parcel_config)?;

    Ok((parcel_config, files))
  }
}

fn serde_to_diagnostic_error(error: serde_json5::Error, file: File) -> DiagnosticError {
  let mut diagnostic_error = DiagnosticBuilder::default();
  diagnostic_error.message(format!("Failed to parse {}", file.path.display()));

  match error {
    serde_json5::Error::Message { msg, location } => {
      let location = location.unwrap_or_else(|| Location { column: 1, line: 1 });

      diagnostic_error.code_frames(vec![CodeFrame {
        code_highlights: vec![CodeHighlight {
          message: Some(msg),
          ..CodeHighlight::from([location.line, location.column])
        }],
        ..CodeFrame::from(file)
      }]);
    }
  };

  diagnostic_error!(diagnostic_error)
}

#[cfg(test)]
mod tests {
  use std::sync::Arc;

  use anyhow::anyhow;
  use mockall::predicate::eq;
  use parcel_filesystem::in_memory_file_system::InMemoryFileSystem;
  use parcel_filesystem::FileSystem;
  use parcel_package_manager::MockPackageManager;
  use parcel_package_manager::PackageManager;
  use parcel_package_manager::Resolution;

  use super::*;

  fn fail_package_manager_resolution(package_manager: &mut MockPackageManager) {
    package_manager
      .expect_resolve()
      .return_once(|_specifier, _from| Err(anyhow!("Something bad happened")));
  }

  struct TestPackageManager {
    fs: FileSystemRef,
  }

  impl PackageManager for TestPackageManager {
    fn resolve(&self, specifier: &str, from: &Path) -> anyhow::Result<Resolution> {
      let path = match "true" {
        _s if specifier.starts_with(".") => from.join(specifier),
        _s if specifier.starts_with("@") => self
          .fs
          .cwd()
          .unwrap()
          .join("node_modules")
          .join(specifier)
          .join("index.json"),
        _ => PathBuf::from("Not found"),
      };

      if !self.fs.is_file(&path) {
        return Err(anyhow!("File was missing"));
      }

      Ok(Resolution { resolved: path })
    }
  }

  fn package_manager_resolution(
    package_manager: &mut MockPackageManager,
    specifier: String,
    from: PathBuf,
  ) -> PathBuf {
    let resolved = PathBuf::from("/")
      .join("node_modules")
      .join(specifier.clone())
      .join("index.json");

    package_manager
      .expect_resolve()
      .with(eq(specifier), eq(from))
      .returning(|specifier, _from| {
        Ok(Resolution {
          resolved: PathBuf::from("/")
            .join("node_modules")
            .join(specifier)
            .join("index.json"),
        })
      });

    resolved
  }

  mod empty_config_and_fallback {
    use crate::parcel_config_fixtures::default_config;
    use crate::parcel_config_fixtures::default_extended_config;

    use super::*;

    #[test]
    fn errors_on_missing_parcelrc_file() {
      let fs = Arc::new(InMemoryFileSystem::default());
      let project_root = fs.cwd().unwrap();

      let err = ParcelRcConfigLoader::new(fs, Arc::new(MockPackageManager::new()))
        .load(&project_root, LoadConfigOptions::default())
        .map_err(|e| e.to_string());

      assert_eq!(
        err,
        Err(format!(
          "Unable to locate .parcelrc from {}",
          project_root.display()
        ))
      );
    }

    #[test]
    fn errors_on_failed_extended_parcelrc_resolution() {
      let fs = Arc::new(InMemoryFileSystem::default());
      let project_root = fs.cwd().unwrap();

      let config = default_extended_config(&project_root);

      fs.write_file(&config.base_config.path, config.base_config.parcel_rc);

      let fs: FileSystemRef = fs;
      let package_manager = Arc::new(TestPackageManager {
        fs: Arc::clone(&fs),
      });

      let err = ParcelRcConfigLoader::new(Arc::clone(&fs), package_manager)
        .load(&project_root, LoadConfigOptions::default())
        .map_err(|e| e.to_string());

      assert_eq!(
        err,
        Err(format!(
          "Failed to resolve extended config @parcel/config-default from {}",
          config.base_config.path.display()
        ))
      );
    }

    #[test]
    fn returns_default_parcel_config() {
      let fs = Arc::new(InMemoryFileSystem::default());
      let project_root = fs.cwd().unwrap();

      let default_config = default_config(Arc::new(project_root.join(".parcelrc")));
      let files = vec![default_config.path.clone()];

      fs.write_file(&default_config.path, default_config.parcel_rc);

      let parcel_config = ParcelRcConfigLoader::new(fs, Arc::new(MockPackageManager::default()))
        .load(&project_root, LoadConfigOptions::default())
        .map_err(|e| e.to_string());

      assert_eq!(parcel_config, Ok((default_config.parcel_config, files)));
    }

    #[test]
    fn returns_default_parcel_config_from_project_root() {
      let fs = Arc::new(InMemoryFileSystem::default());
      let project_root = fs.cwd().unwrap().join("src").join("packages").join("root");

      let default_config = default_config(Arc::new(project_root.join(".parcelrc")));
      let files = vec![default_config.path.clone()];

      fs.write_file(&default_config.path, default_config.parcel_rc);

      let parcel_config = ParcelRcConfigLoader::new(fs, Arc::new(MockPackageManager::default()))
        .load(&project_root, LoadConfigOptions::default())
        .map_err(|e| e.to_string());

      assert_eq!(parcel_config, Ok((default_config.parcel_config, files)));
    }

    #[test]
    fn returns_default_parcel_config_from_project_root_when_outside_cwd() {
      let fs = Arc::new(InMemoryFileSystem::default());
      let project_root = PathBuf::from("/root");

      let default_config = default_config(Arc::new(project_root.join(".parcelrc")));
      let files = vec![default_config.path.clone()];

      fs.set_current_working_directory(PathBuf::from("/cwd"));
      fs.write_file(&default_config.path, default_config.parcel_rc);

      let parcel_config = ParcelRcConfigLoader::new(fs, Arc::new(MockPackageManager::default()))
        .load(&project_root, LoadConfigOptions::default())
        .map_err(|e| e.to_string());

      assert_eq!(parcel_config, Ok((default_config.parcel_config, files)));
    }

    #[test]
    fn returns_merged_default_parcel_config() {
      let fs = Arc::new(InMemoryFileSystem::default());
      let project_root = fs.cwd().unwrap();

      let default_config = default_extended_config(&project_root);
      let files = vec![
        default_config.base_config.path.clone(),
        default_config.extended_config.path.clone(),
      ];

      fs.write_file(
        &default_config.base_config.path,
        default_config.base_config.parcel_rc,
      );

      fs.write_file(
        &default_config.extended_config.path,
        default_config.extended_config.parcel_rc,
      );

      let fs: FileSystemRef = fs;
      let package_manager = Arc::new(TestPackageManager {
        fs: Arc::clone(&fs),
      });

      let parcel_config = ParcelRcConfigLoader::new(Arc::clone(&fs), package_manager)
        .load(&project_root, LoadConfigOptions::default())
        .map_err(|e| e.to_string());

      assert_eq!(parcel_config, Ok((default_config.parcel_config, files)));
    }
  }

  mod config {
    use parcel_core::types::Diagnostic;

    use crate::parcel_config_fixtures::config;
    use crate::parcel_config_fixtures::extended_config;

    use super::*;

    #[test]
    fn errors_on_failed_config_resolution() {
      let fs = Arc::new(InMemoryFileSystem::default());
      let mut package_manager = MockPackageManager::new();
      let project_root = fs.cwd().unwrap();

      fail_package_manager_resolution(&mut package_manager);

      let package_manager = Arc::new(package_manager);

      let err = ParcelRcConfigLoader::new(fs, package_manager)
        .load(
          &&project_root,
          LoadConfigOptions {
            additional_reporters: Vec::new(),
            config: Some("@scope/config"),
            fallback_config: None,
          },
        )
        .map_err(|e| e.to_string());

      assert_eq!(
        err,
        Err(format!(
          "Failed to resolve config @scope/config from {}",
          project_root.join("index").display()
        ))
      );
    }

    #[test]
    fn errors_on_failed_extended_config_resolution() {
      let fs = Arc::new(InMemoryFileSystem::default());
      let project_root = fs.cwd().unwrap();

      let (specifier, config) = extended_config(&project_root);

      fs.write_file(&config.base_config.path, config.base_config.parcel_rc);

      let fs: FileSystemRef = fs;
      let package_manager = Arc::new(TestPackageManager {
        fs: Arc::clone(&fs),
      });

      let err = ParcelRcConfigLoader::new(Arc::clone(&fs), package_manager)
        .load(
          &project_root,
          LoadConfigOptions {
            additional_reporters: Vec::new(),
            config: Some(&specifier),
            fallback_config: None,
          },
        )
        .map_err(|e| e.to_string());

      assert_eq!(
        err,
        Err(format!(
          "Failed to resolve extended config @parcel/config-default from {}",
          config.base_config.path.display()
        ))
      );
    }

    #[test]
    fn errors_on_missing_config_file() {
      let fs = Arc::new(InMemoryFileSystem::default());
      let mut package_manager = MockPackageManager::new();
      let project_root = fs.cwd().unwrap();

      fs.write_file(&project_root.join(".parcelrc"), String::from("{}"));

      let config_path = package_manager_resolution(
        &mut package_manager,
        String::from("@scope/config"),
        project_root.join("index"),
      );

      let fs: FileSystemRef = fs;
      let package_manager = Arc::new(package_manager);

      let err = ParcelRcConfigLoader::new(fs, package_manager)
        .load(
          &project_root,
          LoadConfigOptions {
            additional_reporters: Vec::new(),
            config: Some("@scope/config"),
            fallback_config: None,
          },
        )
        .unwrap_err()
        .downcast::<Diagnostic>()
        .expect("Expected diagnostic error");

      assert_eq!(
        err,
        DiagnosticBuilder::default()
          .code_frames(vec![CodeFrame::from(config_path)])
          .message("File not found")
          .origin(Some(String::from("parcel_config::parcel_rc_config_loader")))
          .build()
          .unwrap()
      );
    }

    #[test]
    fn returns_specified_config() {
      let fs = Arc::new(InMemoryFileSystem::default());
      let project_root = fs.cwd().unwrap();

      let (specifier, specified_config) = config(&project_root);
      let files = vec![specified_config.path.clone()];

      fs.write_file(&project_root.join(".parcelrc"), String::from("{}"));
      fs.write_file(&specified_config.path, specified_config.parcel_rc);

      let fs: FileSystemRef = fs;
      let package_manager = Arc::new(TestPackageManager {
        fs: Arc::clone(&fs),
      });

      let parcel_config = ParcelRcConfigLoader::new(Arc::clone(&fs), package_manager)
        .load(
          &project_root,
          LoadConfigOptions {
            additional_reporters: Vec::new(),
            config: Some(&specifier),
            fallback_config: None,
          },
        )
        .map_err(|e| e.to_string());

      assert_eq!(parcel_config, Ok((specified_config.parcel_config, files)));
    }
  }

  mod fallback_config {
    use parcel_core::types::Diagnostic;

    use crate::parcel_config_fixtures::default_config;
    use crate::parcel_config_fixtures::extended_config;
    use crate::parcel_config_fixtures::fallback_config;

    use super::*;

    #[test]
    fn errors_on_failed_fallback_resolution() {
      let fs = Arc::new(InMemoryFileSystem::default());
      let mut package_manager = MockPackageManager::new();
      let project_root = fs.cwd().unwrap();

      fail_package_manager_resolution(&mut package_manager);

      let package_manager = Arc::new(package_manager);

      let err = ParcelRcConfigLoader::new(fs, package_manager)
        .load(
          &project_root,
          LoadConfigOptions {
            additional_reporters: Vec::new(),
            config: None,
            fallback_config: Some("@parcel/config-default"),
          },
        )
        .map_err(|e| e.to_string());

      assert_eq!(
        err,
        Err(format!(
          "Failed to resolve fallback @parcel/config-default from {}",
          project_root.join("index").display()
        ))
      );
    }

    #[test]
    fn errors_on_failed_extended_fallback_config_resolution() {
      let fs = Arc::new(InMemoryFileSystem::default());
      let project_root = fs.cwd().unwrap();

      let (fallback_specifier, fallback) = extended_config(&project_root);

      fs.write_file(&fallback.base_config.path, fallback.base_config.parcel_rc);

      let fs: FileSystemRef = fs;
      let package_manager = Arc::new(TestPackageManager {
        fs: Arc::clone(&fs),
      });

      let err = ParcelRcConfigLoader::new(Arc::clone(&fs), package_manager)
        .load(
          &project_root,
          LoadConfigOptions {
            additional_reporters: Vec::new(),
            config: None,
            fallback_config: Some(&fallback_specifier),
          },
        )
        .map_err(|e| e.to_string());

      assert_eq!(
        err,
        Err(format!(
          "Failed to resolve extended config @parcel/config-default from {}",
          fallback.base_config.path.display()
        ))
      );
    }

    #[test]
    fn errors_on_missing_fallback_config_file() {
      let fs = Arc::new(InMemoryFileSystem::default());
      let mut package_manager = MockPackageManager::new();
      let project_root = fs.cwd().unwrap();

      let fallback_config_path = package_manager_resolution(
        &mut package_manager,
        String::from("@parcel/config-default"),
        project_root.join("index"),
      );

      let package_manager = Arc::new(package_manager);

      let err = ParcelRcConfigLoader::new(fs, package_manager)
        .load(
          &project_root,
          LoadConfigOptions {
            additional_reporters: Vec::new(),
            config: None,
            fallback_config: Some("@parcel/config-default"),
          },
        )
        .unwrap_err()
        .downcast::<Diagnostic>()
        .expect("Expected diagnostic error");

      assert_eq!(
        err,
        DiagnosticBuilder::default()
          .code_frames(vec![CodeFrame::from(fallback_config_path)])
          .message("File not found")
          .origin(Some(String::from("parcel_config::parcel_rc_config_loader")))
          .build()
          .unwrap()
      );
    }

    #[test]
    fn returns_project_root_parcel_rc() {
      let fs = Arc::new(InMemoryFileSystem::default());
      let project_root = fs.cwd().unwrap();

      let (fallback_specifier, fallback) = fallback_config(&project_root);
      let project_root_config = default_config(Arc::new(project_root.join(".parcelrc")));

      fs.write_file(&project_root_config.path, project_root_config.parcel_rc);
      fs.write_file(&fallback.path, String::from("{}"));

      let fs: FileSystemRef = fs;
      let package_manager = Arc::new(TestPackageManager {
        fs: Arc::clone(&fs),
      });

      let parcel_config = ParcelRcConfigLoader::new(Arc::clone(&fs), package_manager)
        .load(
          &project_root,
          LoadConfigOptions {
            additional_reporters: Vec::new(),
            config: None,
            fallback_config: Some(&fallback_specifier),
          },
        )
        .map_err(|e| e.to_string());

      assert_eq!(
        parcel_config,
        Ok((
          project_root_config.parcel_config,
          vec!(project_root_config.path)
        ))
      );
    }

    #[test]
    fn returns_fallback_config_when_parcel_rc_is_missing() {
      let fs = Arc::new(InMemoryFileSystem::default());
      let project_root = fs.cwd().unwrap();

      let (fallback_specifier, fallback) = fallback_config(&project_root);
      let files = vec![fallback.path.clone()];

      fs.write_file(&fallback.path, fallback.parcel_rc);

      let fs: FileSystemRef = fs;
      let package_manager = Arc::new(TestPackageManager {
        fs: Arc::clone(&fs),
      });

      let parcel_config = ParcelRcConfigLoader::new(Arc::clone(&fs), package_manager)
        .load(
          &project_root,
          LoadConfigOptions {
            additional_reporters: Vec::new(),
            config: None,
            fallback_config: Some(&fallback_specifier),
          },
        )
        .map_err(|e| e.to_string());

      assert_eq!(parcel_config, Ok((fallback.parcel_config, files)));
    }
  }

  mod fallback_with_config {
    use crate::parcel_config_fixtures::config;
    use crate::parcel_config_fixtures::fallback_config;

    use super::*;

    #[test]
    fn returns_specified_config() {
      let fs = Arc::new(InMemoryFileSystem::default());
      let project_root = fs.cwd().unwrap();

      let (config_specifier, config) = config(&project_root);
      let (fallback_config_specifier, fallback_config) = fallback_config(&project_root);

      let files = vec![config.path.clone()];

      fs.write_file(&config.path, config.parcel_rc);
      fs.write_file(&fallback_config.path, fallback_config.parcel_rc);

      let fs: FileSystemRef = fs;
      let package_manager = Arc::new(TestPackageManager {
        fs: Arc::clone(&fs),
      });

      let parcel_config = ParcelRcConfigLoader::new(Arc::clone(&fs), package_manager)
        .load(
          &project_root,
          LoadConfigOptions {
            additional_reporters: Vec::new(),
            config: Some(&config_specifier),
            fallback_config: Some(&fallback_config_specifier),
          },
        )
        .map_err(|e| e.to_string());

      assert_eq!(parcel_config, Ok((config.parcel_config, files)));
    }

    #[test]
    fn returns_fallback_config_when_config_file_missing() {
      let fs = Arc::new(InMemoryFileSystem::default());
      let project_root = fs.cwd().unwrap();

      let (config_specifier, _config) = config(&project_root);
      let (fallback_config_specifier, fallback) = fallback_config(&project_root);

      let files = vec![fallback.path.clone()];

      fs.write_file(&fallback.path, fallback.parcel_rc);

      let fs: FileSystemRef = fs;
      let package_manager = Arc::new(TestPackageManager {
        fs: Arc::clone(&fs),
      });

      let parcel_config = ParcelRcConfigLoader::new(Arc::clone(&fs), package_manager)
        .load(
          &project_root,
          LoadConfigOptions {
            additional_reporters: Vec::new(),
            config: Some(&config_specifier),
            fallback_config: Some(&fallback_config_specifier),
          },
        )
        .map_err(|e| e.to_string());

      assert_eq!(parcel_config, Ok((fallback.parcel_config, files)));
    }
  }
}
