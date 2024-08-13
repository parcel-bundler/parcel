use serde::{Deserialize, Deserializer};

#[derive(Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Jsx {
  Preserve,
  React,
  ReactJsx,
  #[serde(rename = "react-jsxdev")]
  ReactJsxDev,
  ReactNative,
}

pub enum Target {
  ES3,
  ES5,
  ES6,
  ES2015,
  ES2016,
  ES2017,
  ES2018,
  ES2019,
  ES2020,
  ES2021,
  ES2022,
  ES2023,
  ESNext,
  #[allow(dead_code)]
  Other(String),
}

impl<'de> Deserialize<'de> for Target {
  fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
  where
    D: Deserializer<'de>,
  {
    let target = String::deserialize(deserializer)?.to_lowercase();

    Ok(match target.as_str() {
      "es3" => Target::ES3,
      "es5" => Target::ES5,
      "es6" => Target::ES6,
      "es2015" => Target::ES2015,
      "es2016" => Target::ES2016,
      "es2017" => Target::ES2017,
      "es2018" => Target::ES2018,
      "es2019" => Target::ES2019,
      "es2020" => Target::ES2020,
      "es2021" => Target::ES2021,
      "es2022" => Target::ES2022,
      "es2023" => Target::ES2023,
      "esnext" => Target::ESNext,
      other => Target::Other(other.to_string()),
    })
  }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompilerOptions {
  pub experimental_decorators: Option<bool>,
  pub jsx: Option<Jsx>,
  pub jsx_factory: Option<String>,
  pub jsx_import_source: Option<String>,
  pub jsx_fragment_factory: Option<String>,
  pub target: Option<Target>,
  pub use_define_for_class_fields: Option<bool>,
}

/// Refer to https://www.typescriptlang.org/tsconfig
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TsConfig {
  pub compiler_options: Option<CompilerOptions>,
}
