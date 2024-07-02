use std::{
  collections::HashSet,
  sync::{Arc, RwLock},
};

use lightningcss::{
  css_modules::CssModuleReference,
  dependencies::DependencyOptions,
  printer::PrinterOptions,
  stylesheet::{MinifyOptions, ParserFlags, ParserOptions, StyleSheet},
  targets::{Browsers, Features, Targets},
};
use parcel_resolver::ExportsCondition;

use crate::{
  diagnostic::Diagnostic,
  environment::Version,
  requests::asset_request::{Transformer, TransformerResult},
  types::{
    Asset, AssetFlags, Dependency, DependencyFlags, ParcelOptions, Priority, SpecifierType, Symbol,
    SymbolFlags,
  },
  worker_farm::WorkerFarm,
};

pub struct CssTransformer;

impl Transformer for CssTransformer {
  fn transform(
    &self,
    mut asset: Asset,
    code: Vec<u8>,
    _farm: &WorkerFarm,
    options: &ParcelOptions,
  ) -> Result<TransformerResult, Vec<Diagnostic>> {
    let code = unsafe { std::str::from_utf8_unchecked(&code) };
    let warnings = Some(Arc::new(RwLock::new(Vec::new())));
    let mut css_modules = None;
    if asset.flags.contains(AssetFlags::IS_SOURCE)
      && asset
        .file_path
        .file_name()
        .and_then(|f| f.to_str())
        .map(|s| s.contains(".module."))
        .unwrap_or(false)
    {
      css_modules = Some(lightningcss::css_modules::Config {
        ..Default::default()
      })
    }

    let mut stylesheet = StyleSheet::parse(
      code,
      ParserOptions {
        filename: asset.file_path.to_string_lossy().into_owned(),
        flags: ParserFlags::empty(),
        css_modules,
        source_index: 0,
        error_recovery: false,
        warnings,
      },
    )
    .unwrap();

    let targets = Targets {
      browsers: Some(Browsers {
        android: convert_version(&asset.env.engines.browsers.android),
        chrome: convert_version(&asset.env.engines.browsers.chrome),
        edge: convert_version(&asset.env.engines.browsers.edge),
        firefox: convert_version(&asset.env.engines.browsers.firefox),
        ie: convert_version(&asset.env.engines.browsers.ie),
        ios_saf: convert_version(&asset.env.engines.browsers.ios_saf),
        opera: convert_version(&asset.env.engines.browsers.opera),
        safari: convert_version(&asset.env.engines.browsers.safari),
        samsung: convert_version(&asset.env.engines.browsers.samsung),
      }),
      include: Features::empty(),
      exclude: Features::empty(),
    };

    stylesheet
      .minify(MinifyOptions {
        targets,
        unused_symbols: HashSet::new(),
      })
      .unwrap();

    let result = stylesheet
      .to_css(PrinterOptions {
        minify: false,
        source_map: None,
        project_root: options.project_root.to_str(),
        targets,
        analyze_dependencies: Some(DependencyOptions {
          remove_imports: false,
        }),
        pseudo_classes: None,
      })
      .unwrap();

    let mut dependencies = result
      .dependencies
      .unwrap()
      .into_iter()
      .map(|dep| match dep {
        lightningcss::dependencies::Dependency::Import(import) => {
          let mut d = Dependency::new_from_asset(&asset, import.url, SpecifierType::Url);
          d.package_conditions = ExportsCondition::STYLE;
          d.placeholder = Some(import.placeholder.into());
          d
        }
        lightningcss::dependencies::Dependency::Url(url) => {
          let mut d = Dependency::new_from_asset(&asset, url.url, SpecifierType::Url);
          d.placeholder = Some(url.placeholder.into());
          d.priority = Priority::Lazy;
          d
        }
      })
      .collect::<Vec<_>>();

    let mut imports = String::new();
    if let Some(exports) = result.exports {
      asset.flags.insert(AssetFlags::HAS_SYMBOLS);
      asset.symbols.push(Symbol {
        exported: "*".into(),
        local: "*".into(),
        flags: SymbolFlags::empty(),
        loc: None,
      });

      let mut dep_count = 0;
      for (key, exp) in exports {
        let mut flags = SymbolFlags::empty();
        flags.set(SymbolFlags::SELF_REFERENCED, exp.is_referenced);
        let mut local = exp.name;

        for composes in exp.composes {
          match composes {
            CssModuleReference::Local { name } => {
              if let Some(sym) = asset
                .symbols
                .iter_mut()
                .find(|s| s.exported == name.as_str())
              {
                sym.flags |= SymbolFlags::SELF_REFERENCED;
                local += &format!(" {}", name);
              }
            }
            CssModuleReference::Global { name } => {
              local += &format!(" {}", name);
            }
            CssModuleReference::Dependency { name, specifier } => {
              imports += &format!("@import \"{}\";\n", specifier);
              let dep = dependencies.iter_mut().find(|d| d.specifier == specifier);
              let dep = if let Some(dep) = dep {
                dep
              } else {
                let idx = dependencies.len();
                dependencies.push(Dependency::new_from_asset(
                  &asset,
                  specifier,
                  SpecifierType::Esm,
                ));
                &mut dependencies[idx]
              };

              let s = format!("${}${}", asset.id, dep_count);
              dep_count += 1;
              local += &format!(" {}", s);

              dep.package_conditions |= ExportsCondition::STYLE;
              dep.flags |= DependencyFlags::HAS_SYMBOLS;
              dep.symbols.push(Symbol {
                exported: name.into(),
                local: s.into(),
                flags: SymbolFlags::empty(),
                loc: None,
              });
            }
          }
        }

        asset.symbols.push(Symbol {
          exported: key.into(),
          local: local.into(),
          flags,
          loc: None,
        });
      }

      // println!("{:?} {:?}", asset.symbols, dependencies);
    }

    let mut code = result.code;
    if !imports.is_empty() {
      code = format!("{}{}", imports, code);
    }

    Ok(TransformerResult {
      asset,
      code: code.into_bytes(),
      dependencies,
      invalidations: vec![],
    })
  }
}

fn convert_version(version: &Option<Version>) -> Option<u32> {
  version.map(|version| (version.major() << 8 | version.minor()) as u32)
}
