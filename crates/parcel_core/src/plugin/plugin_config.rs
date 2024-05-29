use std::path::PathBuf;
use std::rc::Rc;

use parcel_filesystem::search::find_ancestor_file;
use parcel_filesystem::FileSystem;
use serde::de::DeserializeOwned;

use crate::types::JSONObject;

/// Enables plugins to load config in various formats
pub struct PluginConfig {
  fs: Rc<dyn FileSystem>,
  project_root: PathBuf,
  search_path: PathBuf,
}

// TODO JavaScript configs, invalidations, dev deps, etc
impl PluginConfig {
  pub fn new(fs: Rc<dyn FileSystem>, project_root: PathBuf, search_path: PathBuf) -> Self {
    Self {
      fs,
      project_root,
      search_path,
    }
  }

  pub fn load_json_config<Config: DeserializeOwned>(
    &self,
    filename: &str,
  ) -> Result<(PathBuf, Config), anyhow::Error> {
    let config_path = find_ancestor_file(
      Rc::clone(&self.fs),
      vec![String::from(filename)],
      &self.search_path,
      &self.project_root,
    )
    .ok_or(anyhow::Error::msg(format!(
      "Unable to locate {} config file from {}",
      filename,
      self.search_path.display()
    )))?;

    let config = self.fs.read_to_string(&config_path)?;
    let config = serde_json::from_str::<Config>(&config)?;

    Ok((config_path, config))
  }

  pub fn load_package_json_config(
    &self,
    key: &str,
  ) -> Result<(PathBuf, serde_json::Value), anyhow::Error> {
    let (config_path, config) = self.load_json_config::<JSONObject>("package.json")?;
    let config = config.get(key).ok_or(anyhow::Error::msg(format!(
      "Unable to locate {} config key in {}",
      key,
      config_path.display()
    )))?;

    Ok((config_path, config.clone()))
  }
}

#[cfg(test)]
mod tests {
  use parcel_filesystem::in_memory_file_system::InMemoryFileSystem;

  use super::*;

  mod load_json_config {
    use serde::Deserialize;

    use super::*;

    #[derive(Debug, Deserialize, PartialEq)]
    struct JsonConfig {}

    #[test]
    fn returns_an_error_when_the_config_does_not_exist() {
      let project_root = PathBuf::from("/project-root");
      let search_path = project_root.join("index");

      let config = PluginConfig {
        fs: Rc::new(InMemoryFileSystem::default()),
        project_root,
        search_path: search_path.clone(),
      };

      assert_eq!(
        config
          .load_json_config::<JsonConfig>("config.json")
          .map_err(|err| err.to_string()),
        Err(format!(
          "Unable to locate config.json config file from {}",
          search_path.display()
        ))
      )
    }

    #[test]
    fn returns_an_error_when_the_config_is_outside_the_search_path() {
      let fs = Rc::new(InMemoryFileSystem::default());
      let project_root = PathBuf::from("/project-root");
      let search_path = project_root.join("index");

      fs.write_file(
        &search_path.join("packages").join("config.json"),
        String::from("{}"),
      );

      let config = PluginConfig {
        fs,
        project_root: PathBuf::default(),
        search_path: search_path.clone(),
      };

      assert_eq!(
        config
          .load_json_config::<JsonConfig>("config.json")
          .map_err(|err| err.to_string()),
        Err(format!(
          "Unable to locate config.json config file from {}",
          search_path.display()
        ))
      )
    }

    #[test]
    fn returns_an_error_when_the_config_is_outside_the_project_root() {
      let fs = Rc::new(InMemoryFileSystem::default());
      let project_root = PathBuf::from("/project-root");
      let search_path = project_root.join("index");

      fs.write_file(&PathBuf::from("config.json"), String::from("{}"));

      let config = PluginConfig {
        fs,
        project_root,
        search_path: search_path.clone(),
      };

      assert_eq!(
        config
          .load_json_config::<JsonConfig>("config.json")
          .map_err(|err| err.to_string()),
        Err(format!(
          "Unable to locate config.json config file from {}",
          search_path.display()
        ))
      )
    }

    #[test]
    fn returns_json_config_at_search_path() {
      let fs = Rc::new(InMemoryFileSystem::default());
      let project_root = PathBuf::from("/project-root");
      let search_path = project_root.join("index");
      let config_path = search_path.join("config.json");

      fs.write_file(&config_path, String::from("{}"));

      let config = PluginConfig {
        fs,
        project_root,
        search_path,
      };

      assert_eq!(
        config
          .load_json_config::<JsonConfig>("config.json")
          .map_err(|err| err.to_string()),
        Ok((config_path, JsonConfig {}))
      )
    }

    #[test]
    fn returns_json_config_at_project_root() {
      let fs = Rc::new(InMemoryFileSystem::default());
      let project_root = PathBuf::from("/project-root");
      let search_path = project_root.join("index");
      let config_path = project_root.join("config.json");

      fs.write_file(&config_path, String::from("{}"));

      let config = PluginConfig {
        fs,
        project_root,
        search_path,
      };

      assert_eq!(
        config
          .load_json_config::<JsonConfig>("config.json")
          .map_err(|err| err.to_string()),
        Ok((config_path, JsonConfig {}))
      )
    }
  }

  mod load_package_json_config {
    use serde_json::Map;
    use serde_json::Value;

    use super::*;

    fn package_json() -> String {
      String::from(
        r#"
        {
          "plugin": {
            "enabled": true
          }
        }
      "#,
      )
    }

    fn package_config() -> Value {
      let mut map = Map::new();

      map.insert(String::from("enabled"), Value::Bool(true));

      Value::Object(map)
    }

    #[test]
    fn returns_an_error_when_package_json_does_not_exist() {
      let project_root = PathBuf::from("/project-root");
      let search_path = project_root.join("index");

      let config = PluginConfig {
        fs: Rc::new(InMemoryFileSystem::default()),
        project_root,
        search_path: search_path.clone(),
      };

      assert_eq!(
        config
          .load_package_json_config("plugin")
          .map_err(|err| err.to_string()),
        Err(format!(
          "Unable to locate package.json config file from {}",
          search_path.display()
        ))
      )
    }

    #[test]
    fn returns_an_error_when_config_key_does_not_exist_at_search_path() {
      let fs = Rc::new(InMemoryFileSystem::default());
      let project_root = PathBuf::from("/project-root");
      let search_path = project_root.join("index");
      let package_path = search_path.join("package.json");

      fs.write_file(&package_path, String::from("{}"));
      fs.write_file(&project_root.join("package.json"), package_json());

      let config = PluginConfig {
        fs,
        project_root,
        search_path,
      };

      assert_eq!(
        config
          .load_package_json_config("plugin")
          .map_err(|err| err.to_string()),
        Err(format!(
          "Unable to locate plugin config key in {}",
          package_path.display()
        ))
      )
    }

    #[test]
    fn returns_an_error_when_config_key_does_not_exist_at_project_root() {
      let fs = Rc::new(InMemoryFileSystem::default());
      let project_root = PathBuf::from("/project-root");
      let search_path = project_root.join("index");
      let package_path = project_root.join("package.json");

      fs.write_file(&package_path, String::from("{}"));

      let config = PluginConfig {
        fs,
        project_root,
        search_path,
      };

      assert_eq!(
        config
          .load_package_json_config("plugin")
          .map_err(|err| err.to_string()),
        Err(format!(
          "Unable to locate plugin config key in {}",
          package_path.display()
        ))
      )
    }

    #[test]
    fn returns_package_config_at_search_path() {
      let fs = Rc::new(InMemoryFileSystem::default());
      let project_root = PathBuf::from("/project-root");
      let search_path = project_root.join("index");
      let package_path = search_path.join("package.json");

      fs.write_file(&package_path, package_json());

      let config = PluginConfig {
        fs,
        project_root,
        search_path,
      };

      assert_eq!(
        config
          .load_package_json_config("plugin")
          .map_err(|err| err.to_string()),
        Ok((package_path, package_config()))
      )
    }

    #[test]
    fn returns_package_config_at_project_root() {
      let fs = Rc::new(InMemoryFileSystem::default());
      let project_root = PathBuf::from("/project-root");
      let search_path = project_root.join("index");
      let package_path = project_root.join("package.json");

      fs.write_file(&package_path, package_json());

      let config = PluginConfig {
        fs,
        project_root,
        search_path,
      };

      assert_eq!(
        config
          .load_package_json_config("plugin")
          .map_err(|err| err.to_string()),
        Ok((package_path, package_config()))
      )
    }
  }
}
