use std::path::Path;
use std::path::PathBuf;

use parcel_filesystem::search::find_ancestor_file;
use parcel_filesystem::FileSystem;
use parcel_package_manager::PackageManager;
use pathdiff::diff_paths;

use super::config_error::ConfigError;
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
pub struct ParcelRcConfigLoader<'a, T, U> {
  fs: &'a T,
  package_manager: &'a U,
}

impl<'a, T: FileSystem, U: PackageManager> ParcelRcConfigLoader<'a, T, U> {
  pub fn new(fs: &'a T, package_manager: &'a U) -> Self {
    ParcelRcConfigLoader {
      fs,
      package_manager,
    }
  }

  fn find_config(&self, project_root: &Path, path: &PathBuf) -> Result<PathBuf, ConfigError> {
    let from = path.parent().unwrap_or(path);

    find_ancestor_file(self.fs, vec![String::from(".parcelrc")], from, project_root)
      .ok_or(ConfigError::MissingParcelRc(PathBuf::from(from)))
  }

  fn resolve_from(&self, project_root: &PathBuf) -> PathBuf {
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

  fn load_config(&self, path: PathBuf) -> Result<(PartialParcelConfig, Vec<PathBuf>), ConfigError> {
    let parcel_rc =
      self
        .fs
        .read_to_string(&path)
        .map_err(|source| ConfigError::ReadConfigFile {
          path: path.clone(),
          source,
        })?;

    let contents =
      serde_json5::from_str(&parcel_rc).map_err(|source| ConfigError::ParseFailure {
        path: path.clone(),
        source,
      })?;

    self.process_config(&ParcelRcFile { path, contents })
  }

  fn resolve_extends(
    &self,
    config_path: &PathBuf,
    extend: &String,
  ) -> Result<PathBuf, ConfigError> {
    let path = if extend.starts_with(".") {
      config_path.parent().unwrap_or(config_path).join(extend)
    } else {
      self
        .package_manager
        .resolve(extend, config_path)
        .map_err(|source| ConfigError::UnresolvedConfig {
          config_type: String::from("extended config"),
          from: PathBuf::from(config_path),
          source: Box::new(source),
          specifier: String::from(extend),
        })?
        .resolved
    };

    self
      .fs
      .canonicalize_base(path.clone())
      .map_err(|source| ConfigError::UnresolvedConfig {
        config_type: String::from("extended config"),
        from: path,
        source: Box::new(source),
        specifier: String::from(extend),
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
    parcel_rc: &ParcelRcFile,
  ) -> Result<(PartialParcelConfig, Vec<PathBuf>), ConfigError> {
    let mut files = vec![parcel_rc.path.clone()];
    let extends = parcel_rc.contents.extends.as_ref();
    let extends = match extends {
      None => Vec::new(),
      Some(extends) => match extends {
        Extends::One(ext) => vec![String::from(ext)],
        Extends::Many(ext) => ext.to_vec(),
      },
    };

    if extends.is_empty() {
      return Ok((PartialParcelConfig::try_from(parcel_rc)?, files));
    }

    let mut merged_config: Option<PartialParcelConfig> = None;
    for extend in extends {
      let extended_file_path = self.resolve_extends(&parcel_rc.path, &extend)?;
      let (extended_config, mut extended_file_paths) = self.load_config(extended_file_path)?;

      merged_config = match merged_config {
        None => Some(extended_config),
        Some(config) => Some(PartialParcelConfig::merge(config, extended_config)),
      };

      files.append(&mut extended_file_paths);
    }

    let config = PartialParcelConfig::merge(
      PartialParcelConfig::try_from(parcel_rc)?,
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
    project_root: &PathBuf,
    options: LoadConfigOptions<'a>,
  ) -> Result<(ParcelConfig, Vec<PathBuf>), ConfigError> {
    let resolve_from = self.resolve_from(project_root);
    let mut config_path = match options.config {
      Some(config) => self
        .package_manager
        .resolve(&config, &resolve_from)
        .map(|r| r.resolved)
        .map_err(|source| ConfigError::UnresolvedConfig {
          config_type: String::from("config"),
          from: resolve_from.clone(),
          source: Box::new(source),
          specifier: String::from(config),
        }),
      None => self.find_config(project_root, &resolve_from),
    };

    if !config_path.is_ok() {
      if let Some(fallback_config) = options.fallback_config {
        config_path = self
          .package_manager
          .resolve(&fallback_config, &resolve_from)
          .map(|r| r.resolved)
          .map_err(|source| ConfigError::UnresolvedConfig {
            config_type: String::from("fallback"),
            from: resolve_from,
            source: Box::new(source),
            specifier: String::from(fallback_config),
          });
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

#[cfg(test)]
mod tests {
  use mockall::predicate::eq;
  use parcel_filesystem::in_memory_file_system::InMemoryFileSystem;
  use parcel_package_manager::MockPackageManager;
  use parcel_package_manager::Resolution;
  use parcel_package_manager::ResolveError;

  use super::*;

  fn fail_package_manager_resolution(package_manager: &mut MockPackageManager) {
    package_manager
      .expect_resolve()
      .return_once(|specifier, from| {
        Err(ResolveError::NotFound(
          String::from(specifier),
          from.display().to_string(),
        ))
      });
  }

  struct InMemoryPackageManager<'a> {
    fs: &'a InMemoryFileSystem,
  }

  impl<'a> InMemoryPackageManager<'a> {
    pub fn new(fs: &'a InMemoryFileSystem) -> Self {
      Self { fs }
    }
  }

  impl<'a> PackageManager for InMemoryPackageManager<'a> {
    fn resolve(&self, specifier: &str, from: &Path) -> Result<Resolution, ResolveError> {
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
        return Err(ResolveError::NotFound(
          String::from(specifier),
          from.display().to_string(),
        ));
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
    use std::rc::Rc;

    use super::*;
    use crate::parcel_config_fixtures::default_config;
    use crate::parcel_config_fixtures::default_extended_config;

    #[test]
    fn errors_on_missing_parcelrc_file() {
      let fs = InMemoryFileSystem::default();
      let project_root = fs.cwd().unwrap();

      let err = ParcelRcConfigLoader::new(&fs, &MockPackageManager::new())
        .load(&project_root, LoadConfigOptions::default())
        .map_err(|e| e.to_string());

      assert_eq!(
        err,
        Err(ConfigError::MissingParcelRc(project_root).to_string())
      );
    }

    #[test]
    fn errors_on_failed_extended_parcelrc_resolution() {
      let mut fs = InMemoryFileSystem::default();
      let project_root = fs.cwd().unwrap();

      let config = default_extended_config(&project_root);

      fs.write_file(
        config.base_config.path.clone(),
        config.base_config.parcel_rc,
      );

      let err = ParcelRcConfigLoader::new(&fs, &InMemoryPackageManager::new(&fs))
        .load(&project_root, LoadConfigOptions::default())
        .map_err(|e| e.to_string());

      assert_eq!(
        err,
        Err(
          ConfigError::UnresolvedConfig {
            config_type: String::from("extended config"),
            from: config.base_config.path,
            specifier: String::from("@parcel/config-default"),
            source: Box::new(ResolveError::NotFound(String::from(""), String::from(""))),
          }
          .to_string()
        )
      );
    }

    #[test]
    fn returns_default_parcel_config() {
      let mut fs = InMemoryFileSystem::default();
      let project_root = fs.cwd().unwrap();

      let default_config = default_config(&Rc::new(project_root.join(".parcelrc")));
      let files = vec![default_config.path.clone()];

      fs.write_file(default_config.path, default_config.parcel_rc);

      let parcel_config = ParcelRcConfigLoader::new(&fs, &MockPackageManager::default())
        .load(&project_root, LoadConfigOptions::default())
        .map_err(|e| e.to_string());

      assert_eq!(parcel_config, Ok((default_config.parcel_config, files)));
    }

    #[test]
    fn returns_default_parcel_config_from_project_root() {
      let mut fs = InMemoryFileSystem::default();
      let project_root = fs.cwd().unwrap().join("src").join("packages").join("root");

      let default_config = default_config(&Rc::new(project_root.join(".parcelrc")));
      let files = vec![default_config.path.clone()];

      fs.write_file(default_config.path, default_config.parcel_rc);

      let parcel_config = ParcelRcConfigLoader::new(&fs, &MockPackageManager::default())
        .load(&project_root, LoadConfigOptions::default())
        .map_err(|e| e.to_string());

      assert_eq!(parcel_config, Ok((default_config.parcel_config, files)));
    }

    #[test]
    fn returns_default_parcel_config_from_project_root_when_outside_cwd() {
      let project_root = PathBuf::from("/root");
      let default_config = default_config(&Rc::new(project_root.join(".parcelrc")));
      let files = vec![default_config.path.clone()];
      let mut fs = InMemoryFileSystem::default();

      fs.set_current_working_directory(PathBuf::from("/cwd"));
      fs.write_file(default_config.path, default_config.parcel_rc);

      let parcel_config = ParcelRcConfigLoader::new(&fs, &MockPackageManager::default())
        .load(&project_root, LoadConfigOptions::default())
        .map_err(|e| e.to_string());

      assert_eq!(parcel_config, Ok((default_config.parcel_config, files)));
    }

    #[test]
    fn returns_merged_default_parcel_config() {
      let mut fs = InMemoryFileSystem::default();
      let project_root = fs.cwd().unwrap();

      let default_config = default_extended_config(&project_root);
      let files = vec![
        default_config.base_config.path.clone(),
        default_config.extended_config.path.clone(),
      ];

      fs.write_file(
        default_config.base_config.path,
        default_config.base_config.parcel_rc,
      );

      fs.write_file(
        default_config.extended_config.path,
        default_config.extended_config.parcel_rc,
      );

      let parcel_config = ParcelRcConfigLoader::new(&fs, &InMemoryPackageManager::new(&fs))
        .load(&project_root, LoadConfigOptions::default())
        .map_err(|e| e.to_string());

      assert_eq!(parcel_config, Ok((default_config.parcel_config, files)));
    }
  }

  mod config {
    use super::*;
    use crate::parcel_config_fixtures::config;
    use crate::parcel_config_fixtures::extended_config;

    #[test]
    fn errors_on_failed_config_resolution() {
      let fs = InMemoryFileSystem::default();
      let mut package_manager = MockPackageManager::new();
      let project_root = fs.cwd().unwrap();

      fail_package_manager_resolution(&mut package_manager);

      let err = ParcelRcConfigLoader::new(&fs, &package_manager)
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
        Err(
          ConfigError::UnresolvedConfig {
            config_type: String::from("config"),
            from: project_root.join("index"),
            specifier: String::from("@scope/config"),
            source: Box::new(ResolveError::NotFound(String::from(""), String::from(""))),
          }
          .to_string()
        )
      );
    }

    #[test]
    fn errors_on_failed_extended_config_resolution() {
      let mut fs = InMemoryFileSystem::default();
      let project_root = fs.cwd().unwrap();

      let (specifier, config) = extended_config(&project_root);

      fs.write_file(
        config.base_config.path.clone(),
        config.base_config.parcel_rc,
      );

      let err = ParcelRcConfigLoader::new(&fs, &InMemoryPackageManager::new(&fs))
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
        Err(
          ConfigError::UnresolvedConfig {
            config_type: String::from("extended config"),
            from: config.base_config.path,
            specifier: String::from("@parcel/config-default"),
            source: Box::new(ResolveError::NotFound(String::from(""), String::from(""))),
          }
          .to_string()
        )
      );
    }

    #[test]
    fn errors_on_missing_config_file() {
      let mut fs = InMemoryFileSystem::default();
      let mut package_manager = MockPackageManager::new();
      let project_root = fs.cwd().unwrap();

      fs.write_file(project_root.join(".parcelrc"), String::from("{}"));

      let config_path = package_manager_resolution(
        &mut package_manager,
        String::from("@scope/config"),
        project_root.join("index"),
      );

      let err = ParcelRcConfigLoader::new(&fs, &package_manager)
        .load(
          &project_root,
          LoadConfigOptions {
            additional_reporters: Vec::new(),
            config: Some("@scope/config"),
            fallback_config: None,
          },
        )
        .map_err(|e| e.to_string());

      assert_eq!(
        err,
        Err(
          ConfigError::ReadConfigFile {
            path: config_path,
            source: std::io::Error::new(std::io::ErrorKind::NotFound, "Not found")
          }
          .to_string()
        )
      );
    }

    #[test]
    fn returns_specified_config() {
      let mut fs = InMemoryFileSystem::default();
      let project_root = fs.cwd().unwrap();

      let (specifier, specified_config) = config(&project_root);
      let files = vec![specified_config.path.clone()];

      fs.write_file(project_root.join(".parcelrc"), String::from("{}"));
      fs.write_file(specified_config.path, specified_config.parcel_rc);

      let parcel_config = ParcelRcConfigLoader::new(&fs, &InMemoryPackageManager::new(&fs))
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
    use std::rc::Rc;

    use super::*;
    use crate::parcel_config_fixtures::default_config;
    use crate::parcel_config_fixtures::extended_config;
    use crate::parcel_config_fixtures::fallback_config;

    #[test]
    fn errors_on_failed_fallback_resolution() {
      let fs = InMemoryFileSystem::default();
      let mut package_manager = MockPackageManager::new();
      let project_root = fs.cwd().unwrap();

      fail_package_manager_resolution(&mut package_manager);

      let err = ParcelRcConfigLoader::new(&fs, &package_manager)
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
        Err(
          ConfigError::UnresolvedConfig {
            config_type: String::from("fallback"),
            from: project_root.join("index"),
            specifier: String::from("@parcel/config-default"),
            source: Box::new(ResolveError::NotFound(String::from(""), String::from(""))),
          }
          .to_string()
        )
      );
    }

    #[test]
    fn errors_on_failed_extended_fallback_config_resolution() {
      let mut fs = InMemoryFileSystem::default();
      let project_root = fs.cwd().unwrap();

      let (fallback_specifier, fallback) = extended_config(&project_root);

      fs.write_file(
        fallback.base_config.path.clone(),
        fallback.base_config.parcel_rc,
      );

      let err = ParcelRcConfigLoader::new(&fs, &InMemoryPackageManager::new(&fs))
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
        Err(
          ConfigError::UnresolvedConfig {
            config_type: String::from("extended config"),
            from: fallback.base_config.path,
            specifier: String::from("@parcel/config-default"),
            source: Box::new(ResolveError::NotFound(String::from(""), String::from(""))),
          }
          .to_string()
        ),
      );
    }

    #[test]
    fn errors_on_missing_fallback_config_file() {
      let fs = InMemoryFileSystem::default();
      let mut package_manager = MockPackageManager::new();
      let project_root = fs.cwd().unwrap();

      let fallback_config_path = package_manager_resolution(
        &mut package_manager,
        String::from("@parcel/config-default"),
        project_root.join("index"),
      );

      let err = ParcelRcConfigLoader::new(&InMemoryFileSystem::default(), &package_manager)
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
        Err(
          ConfigError::ReadConfigFile {
            path: fallback_config_path,
            source: std::io::Error::new(std::io::ErrorKind::NotFound, "Not found")
          }
          .to_string()
        )
      );
    }

    #[test]
    fn returns_project_root_parcel_rc() {
      let mut fs = InMemoryFileSystem::default();
      let project_root = fs.cwd().unwrap();

      let (fallback_specifier, fallback) = fallback_config(&project_root);
      let project_root_config = default_config(&Rc::new(project_root.join(".parcelrc")));

      fs.write_file(
        project_root_config.path.clone(),
        project_root_config.parcel_rc,
      );

      fs.write_file(fallback.path, String::from("{}"));

      let parcel_config = ParcelRcConfigLoader::new(&fs, &InMemoryPackageManager::new(&fs))
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
      let mut fs = InMemoryFileSystem::default();
      let project_root = fs.cwd().unwrap();

      let (fallback_specifier, fallback) = fallback_config(&project_root);
      let files = vec![fallback.path.clone()];

      fs.write_file(fallback.path, fallback.parcel_rc);

      let parcel_config = ParcelRcConfigLoader::new(&fs, &InMemoryPackageManager::new(&fs))
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
    use super::*;
    use crate::parcel_config_fixtures::config;
    use crate::parcel_config_fixtures::fallback_config;

    #[test]
    fn returns_specified_config() {
      let mut fs = InMemoryFileSystem::default();
      let project_root = fs.cwd().unwrap();

      let (config_specifier, config) = config(&project_root);
      let (fallback_config_specifier, fallback_config) = fallback_config(&project_root);

      let files = vec![config.path.clone()];

      fs.write_file(config.path, config.parcel_rc);
      fs.write_file(fallback_config.path, fallback_config.parcel_rc);

      let parcel_config = ParcelRcConfigLoader::new(&fs, &InMemoryPackageManager::new(&fs))
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
      let mut fs = InMemoryFileSystem::default();
      let project_root = fs.cwd().unwrap();

      let (config_specifier, _config) = config(&project_root);
      let (fallback_config_specifier, fallback) = fallback_config(&project_root);

      let files = vec![fallback.path.clone()];

      fs.write_file(fallback.path, fallback.parcel_rc);

      let parcel_config = ParcelRcConfigLoader::new(&fs, &InMemoryPackageManager::new(&fs))
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
