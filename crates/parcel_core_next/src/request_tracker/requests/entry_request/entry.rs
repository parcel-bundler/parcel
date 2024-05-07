#[derive(Clone, Debug, Hash, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
  pub file_path: String,
  pub package_path: String,
  pub target: Option<String>,
  // loc
}
