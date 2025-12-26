use std::{
  collections::{HashMap, HashSet},
  path::Path,
  sync::Arc,
};

use lightningcss::{
  bundler::{BundleErrorKind, Bundler, SourceProvider},
  printer::PrinterOptions,
  stylesheet::{MinifyOptions, ParserOptions, StyleAttribute, StyleSheet},
  targets::{Browsers, Targets},
};
use parcel_core::{
  Asset, AssetType, BufferContent, BundleBehavior, Content, Dependency, DependencyFlags,
  DependencyResolution, Diagnostic, Location, Packager, ParcelOptions, Priority, SourceLocation,
  SpecifierType, Transformer, Version,
};

pub struct CssTransformer {}

impl Transformer for CssTransformer {
  fn transform(
    &self,
    mut asset: Asset,
    _options: &ParcelOptions,
  ) -> Result<Asset, Vec<Diagnostic>> {
    // TODO: normalize environment

    let code = asset.content.read()?;
    let code = std::str::from_utf8(&code).map_err(|e| vec![e.into()])?;
    let mut stylesheet = StyleSheet::parse(
      code,
      ParserOptions {
        filename: asset.loc.url.to_string(),
        ..Default::default()
      },
    )
    .unwrap();

    stylesheet
      .minify(MinifyOptions {
        targets: Targets {
          browsers: if asset.env.context.is_browser() {
            let browsers = &asset.env.engines.browsers;
            Some(Browsers {
              chrome: browsers.chrome.map(convert_version),
              firefox: browsers.firefox.map(convert_version),
              safari: browsers.safari.map(convert_version),
              ie: browsers.ie.map(convert_version),
              ios_saf: browsers.ios_saf.map(convert_version),
              android: browsers.android.map(convert_version),
              edge: browsers.edge.map(convert_version),
              opera: browsers.opera.map(convert_version),
              samsung: browsers.samsung.map(convert_version),
            })
          } else {
            None
          },
          ..Default::default()
        },
        ..Default::default()
      })
      .unwrap();

    let res = stylesheet
      .to_css(PrinterOptions {
        analyze_dependencies: Some(Default::default()),
        ..Default::default()
      })
      .unwrap();

    asset.content = Arc::new(BufferContent::new(res.code.into_bytes()));
    for dep in res.dependencies.unwrap() {
      match dep {
        lightningcss::dependencies::Dependency::Import(import) => {
          asset.dependencies.push(Dependency {
            specifier: import.url,
            specifier_type: SpecifierType::Url,
            priority: Priority::Sync,
            bundle_behavior: BundleBehavior::None,
            flags: DependencyFlags::empty(),
            env: asset.env.clone(),
            loc: Some(SourceLocation {
              url: asset.loc.url.clone(),
              start: Location {
                line: import.loc.start.line,
                column: import.loc.end.column,
              },
              end: Location {
                line: import.loc.end.line,
                column: import.loc.end.column,
              },
            }),
            placeholder: Some(import.placeholder),
            resolve_from: Some(asset.loc.url.clone()),
            range: None,
            resolution: DependencyResolution::None,
          });
        }
        lightningcss::dependencies::Dependency::Url(url) => {
          asset.dependencies.push(Dependency {
            specifier: url.url,
            specifier_type: SpecifierType::Url,
            priority: Priority::Sync,
            bundle_behavior: BundleBehavior::None,
            flags: DependencyFlags::empty(),
            env: asset.env.clone(),
            loc: Some(SourceLocation {
              url: asset.loc.url.clone(),
              start: Location {
                line: url.loc.start.line,
                column: url.loc.end.column,
              },
              end: Location {
                line: url.loc.end.line,
                column: url.loc.end.column,
              },
            }),
            placeholder: Some(url.placeholder),
            resolve_from: Some(asset.loc.url.clone()),
            range: None,
            resolution: DependencyResolution::None,
          });
        }
      }
    }

    Ok(asset)
  }
}

pub struct StyleAttrTransformer {}

impl Transformer for StyleAttrTransformer {
  fn transform(
    &self,
    mut asset: Asset,
    _options: &ParcelOptions,
  ) -> Result<Asset, Vec<Diagnostic>> {
    let code = asset.content.read()?;
    let code = std::str::from_utf8(&code).map_err(|e| vec![e.into()])?;
    let mut attr = StyleAttribute::parse(
      code,
      ParserOptions {
        filename: asset.loc.url.to_string(),
        ..Default::default()
      },
    )
    .unwrap();

    attr.minify(MinifyOptions {
      targets: Targets {
        browsers: if asset.env.context.is_browser() {
          let browsers = &asset.env.engines.browsers;
          Some(Browsers {
            chrome: browsers.chrome.map(convert_version),
            firefox: browsers.firefox.map(convert_version),
            safari: browsers.safari.map(convert_version),
            ie: browsers.ie.map(convert_version),
            ios_saf: browsers.ios_saf.map(convert_version),
            android: browsers.android.map(convert_version),
            edge: browsers.edge.map(convert_version),
            opera: browsers.opera.map(convert_version),
            samsung: browsers.samsung.map(convert_version),
          })
        } else {
          None
        },
        ..Default::default()
      },
      ..Default::default()
    });

    let res = attr
      .to_css(PrinterOptions {
        analyze_dependencies: Some(Default::default()),
        ..Default::default()
      })
      .unwrap();

    asset.content = Arc::new(BufferContent::new(res.code.into_bytes()));
    for dep in res.dependencies.unwrap() {
      match dep {
        lightningcss::dependencies::Dependency::Import(_) => unreachable!(),
        lightningcss::dependencies::Dependency::Url(url) => {
          asset.dependencies.push(Dependency {
            specifier: url.url,
            specifier_type: SpecifierType::Url,
            priority: Priority::Sync,
            bundle_behavior: BundleBehavior::None,
            flags: DependencyFlags::empty(),
            env: asset.env.clone(),
            loc: Some(SourceLocation {
              url: asset.loc.url.clone(),
              start: Location {
                line: url.loc.start.line,
                column: url.loc.end.column,
              },
              end: Location {
                line: url.loc.end.line,
                column: url.loc.end.column,
              },
            }),
            placeholder: Some(url.placeholder),
            resolve_from: Some(asset.loc.url.clone()),
            range: None,
            resolution: DependencyResolution::None,
          });
        }
      }
    }

    Ok(asset)
  }
}

fn convert_version(c: Version) -> u32 {
  ((c.major() as u32) << 16) | ((c.minor() as u32) << 8)
}

pub struct CssPackager {}

impl Packager for CssPackager {
  fn package(
    &self,
    bundle_graph: &parcel_core::BundleGraph,
    bundle: &parcel_core::Bundle,
    _get_inline_bundle_content: &dyn Fn(usize) -> Result<Arc<dyn Content>, Vec<Diagnostic>>,
  ) -> Result<Arc<dyn parcel_core::Content>, Vec<Diagnostic>> {
    // Bundler::new(fs, source_map, options)
    let mut assets_by_placeholder = HashMap::new();
    let mut asset_content = HashMap::new();
    let mut entries = HashSet::new();
    for e in &bundle.assets {
      entries.insert(*e);
    }

    for asset_index in &bundle.assets {
      let Some(asset) = &bundle_graph.asset_graph.assets[*asset_index] else {
        continue;
      };

      let content = asset.content.read()?;
      asset_content.insert(*asset_index, String::from_utf8(content).unwrap());

      for dep in &asset.dependencies {
        if let Some(placeholder) = &dep.placeholder {
          if let DependencyResolution::Asset(asset) = dep.resolution {
            assets_by_placeholder.insert(placeholder.as_str(), asset);
            entries.remove(&(asset as usize));
          }
        }
      }
    }

    let fs = LightningFs {
      assets: &asset_content,
      assets_by_placeholder: &assets_by_placeholder,
      entries: &entries,
    };

    let mut bundler = Bundler::new(&fs, None, Default::default());
    let stylesheet = bundler
      .bundle(Path::new("$PARCEL_ENTRY"))
      .map_err(|e| match e.kind {
        BundleErrorKind::ResolverError(d) => d,
        _ => todo!(),
      })?;

    let res = stylesheet.to_css(Default::default()).unwrap();
    let content = Arc::new(BufferContent::new(res.code.into_bytes()));
    Ok(content)
  }
}

struct LightningFs<'a> {
  assets: &'a HashMap<usize, String>,
  assets_by_placeholder: &'a HashMap<&'a str, u32>,
  entries: &'a HashSet<usize>,
}

impl<'x> SourceProvider for LightningFs<'x> {
  type Error = Diagnostic;

  fn read<'a>(&'a self, file: &std::path::Path) -> Result<&'a str, Self::Error> {
    if file == Path::new("$PARCEL_ENTRY") {
      if self.entries.len() == 1 {
        return Ok(self.assets[self.entries.iter().next().unwrap()].as_str());
      } else {
        todo!()
      }
    } else {
      let path = file.to_str().unwrap();
      let index = self.assets_by_placeholder[path];
      Ok(self.assets[&(index as usize)].as_str())
    }
  }

  fn resolve(
    &self,
    specifier: &str,
    _originating_file: &std::path::Path,
  ) -> Result<std::path::PathBuf, Self::Error> {
    Ok(specifier.into())
  }
}

pub struct StyleAttrPackager {}

impl Packager for StyleAttrPackager {
  fn package(
    &self,
    bundle_graph: &parcel_core::BundleGraph,
    bundle: &parcel_core::Bundle,
    _get_inline_bundle_content: &dyn Fn(usize) -> Result<Arc<dyn Content>, Vec<Diagnostic>>,
  ) -> Result<Arc<dyn parcel_core::Content>, Vec<Diagnostic>> {
    assert_eq!(bundle.assets.len(), 1);

    let asset = bundle_graph.asset_graph.assets[bundle.assets[0]]
      .as_ref()
      .unwrap();
    // TODO replace references
    Ok(asset.content.clone())
  }
}
