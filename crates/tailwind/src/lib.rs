use std::{path::Path, sync::Arc};

use parcel_core::{
  Asset, BufferContent, Diagnostic, DiagnosticList, ExportsCondition, ParcelOptions, Transformer,
};
use parcel_plugin_js::{await_promise, require_source, with_js_env};
use parcel_resolver::{Resolution, ResolveOptions, Resolver, SpecifierType};
use rquickjs::{Array, Ctx, Function, Object, Value};
use tailwindcss_oxide::{PublicSourceEntry, Scanner};

pub struct TailwindTransformer;

const COMPILE_JS: &'static str = include_str!("compile.js");

impl Transformer for TailwindTransformer {
  fn transform(
    &self,
    mut asset: Asset,
    options: &ParcelOptions,
    fs: &std::sync::Arc<dyn parcel_core::FileSystem>,
  ) -> Result<Asset, DiagnosticList> {
    let project_root_path = options.project_root;

    let css_bytes = asset.content.read()?;
    let css = String::from_utf8(css_bytes).map_err(Diagnostic::from)?;
    // TODO: skip if tailwind is not present?
    // let canBail = !/@(import|reference|theme|variant|config|plugin|apply|tailwind)\b/.test(source)

    let asset_path = asset.loc.url.to_file_path()?;
    let from = asset_path.to_path_buf().to_string_lossy().into_owned();
    let base = asset_path
      .parent()
      .map(|p| p.to_path_buf().to_string_lossy().into_owned())
      .unwrap_or_default();

    let resolver = Resolver::node(project_root_path);
    let resolver_fs = fs.clone();

    let result_css = with_js_env(fs.clone(), &options.env, options.cwd, move |ctx| {
      let module = require_source(ctx, "tailwind", COMPILE_JS)?;
      let func: Function = module
        .as_object()
        .ok_or(rquickjs::Error::Unknown)?
        .get("compileTailwind")?;

      let resolve_fn =
        move |ctx: Ctx, specifier: String, from: String, kind: u32| -> rquickjs::Result<String> {
          let from_path = parcel_core::PathId::new(Path::new(&from));
          let result = if kind == 1 {
            resolver.resolve_with_options(
              &specifier,
              from_path,
              SpecifierType::Cjs,
              &*resolver_fs,
              ResolveOptions {
                conditions: ExportsCondition::STYLE,
                ..Default::default()
              },
            )
          } else {
            resolver.resolve_with_options(
              &specifier,
              from_path,
              SpecifierType::Cjs,
              &*resolver_fs,
              Default::default(),
            )
          };

          match result {
            Ok(r) => match r.resolution {
              Resolution::Path(p) => Ok(p.to_path_buf().to_string_lossy().into_owned()),
              _ => Err(rquickjs::Exception::throw_message(
                &ctx,
                &format!("Cannot resolve '{}': not a file path", specifier),
              )),
            },
            Err(e) => Err(rquickjs::Exception::throw_message(
              &ctx,
              &format!("Failed to resolve '{}' from '{}': {}", specifier, from, e),
            )),
          }
        };

      let resolve = Function::new(ctx.clone(), resolve_fn)?;

      let get_candidates = Function::new(
        ctx.clone(),
        move |sources: Array| -> rquickjs::Result<Vec<String>> {
          let sources = sources
            .into_iter()
            .map(|source| {
              let source = source?;
              let source = source.as_object().unwrap(); // TODO: error handling
              let base: String = source.get("base")?;
              let pattern: String = source.get("pattern")?;
              let negated: Option<bool> = source.get("negated")?;
              Ok(PublicSourceEntry {
                base,
                pattern,
                negated: negated.unwrap_or_default(),
              })
            })
            .collect::<rquickjs::Result<Vec<PublicSourceEntry>>>()?;

          let mut scanner = Scanner::new(sources);
          Ok(scanner.scan())
        },
      )?;

      let promise: Value = func.call((
        resolve,
        from.as_str(),
        base.as_str(),
        css.as_str(),
        get_candidates,
      ))?;

      let result = await_promise(ctx, promise)?;
      result
        .as_string()
        .ok_or(rquickjs::Error::Unknown)?
        .to_string()
    })?;

    asset.content = Arc::new(BufferContent::new(result_css.into_bytes()));
    Ok(asset)
  }
}
