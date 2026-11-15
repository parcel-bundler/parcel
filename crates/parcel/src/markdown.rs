use parcel_core::{AssetType, BufferContent, Diagnostic, FileSystem, PathId, Transformer};
use std::{path::Path, sync::Arc};

#[derive(Default, serde::Deserialize)]
pub struct MarkdownOptions {
  #[serde(default)]
  pub layout: Option<String>,
  #[serde(default)]
  pub gfm: bool,
}

#[derive(Default)]
pub struct MarkdownTransformer {
  pub layout: Option<String>,
  pub gfm: bool,
}

impl MarkdownTransformer {
  pub fn new(
    config: Option<serde_json::Value>,
    path: PathId,
    fs: Arc<dyn FileSystem>,
  ) -> Result<MarkdownTransformer, Diagnostic> {
    if let Some(config) = config {
      let options = serde_json::from_value::<MarkdownOptions>(config)?;
      let layout = match options.layout {
        Some(layout) => Some(fs.read_to_string(path.resolve(Path::new(&layout)))?),
        None => None,
      };
      Ok(MarkdownTransformer {
        layout,
        gfm: options.gfm,
      })
    } else {
      Ok(MarkdownTransformer::default())
    }
  }
}

impl Transformer for MarkdownTransformer {
  fn transform(
    &self,
    mut asset: parcel_core::Asset,
    _ctx: &parcel_core::PluginContext,
  ) -> Result<parcel_core::Asset, parcel_core::DiagnosticList> {
    let content = asset.content.read_string()?;
    let mut result = markdown::to_html_with_options(
      &content,
      &if self.gfm {
        markdown::Options::gfm()
      } else {
        markdown::Options::default()
      },
    )
    .unwrap();
    if let Some(layout) = &self.layout {
      result = layout.replace("<parcel:content></parcel:content>", &result);
    }
    asset.content = Arc::new(BufferContent::new_string(result));
    asset.ty = AssetType::Html;
    Ok(asset)
  }
}
