use std::{path::Path, sync::Arc};

use parcel_core::{
  Asset, BufferContent, Diagnostic, DiagnosticList, ExportsCondition, ParcelOptions, Transformer,
};
use parcel_plugin_js::{await_promise, require_source, with_js_env};
use parcel_resolver::{Cache, Resolution, ResolveOptions, Resolver, SpecifierType};
use rquickjs::{Array, Ctx, Function, Value};
use tailwindcss_oxide::{PublicSourceEntry, Scanner};

pub struct TailwindTransformer;

const COMPILE_JS: &'static str = include_str!("compile.js");

impl Transformer for TailwindTransformer {
  fn transform(&self, mut asset: Asset, options: &ParcelOptions) -> Result<Asset, DiagnosticList> {
    let project_root_path = options.project_root.to_file_path(&options.project_root)?;
    let mut scanner = Scanner::new(vec![PublicSourceEntry {
      base: project_root_path.to_string_lossy().into_owned(),
      pattern: "**/*".into(),
      negated: false,
    }]);
    let candidates = scanner.scan();

    let css_bytes = asset.content.read()?;
    let css = String::from_utf8(css_bytes).map_err(Diagnostic::from)?;
    // TODO: skip if tailwind is not present?

    let asset_path = asset.loc.url.to_file_path(&options.project_root)?;
    let from = asset_path.to_string_lossy().into_owned();
    let base = asset_path
      .parent()
      .map(|p| p.to_string_lossy().into_owned())
      .unwrap_or_default();

    let resolver = Resolver::node(&project_root_path, Cache::new(options.input_fs.clone()));

    let result_css = with_js_env(
      options.input_fs.clone(),
      &options.env,
      &options.cwd,
      move |ctx| {
        let module = require_source(ctx, "tailwind", COMPILE_JS)?;
        let func: Function = module
          .as_object()
          .ok_or(rquickjs::Error::Unknown)?
          .get("compileTailwind")?;

        let js_candidates = Array::new(ctx.clone())?;
        for (i, candidate) in candidates.iter().enumerate() {
          js_candidates.set(i, candidate.as_str())?;
        }

        let resolve_fn =
          move |ctx: Ctx, specifier: String, from: String, kind: u32| -> rquickjs::Result<String> {
            let from_path = Path::new(&from);
            let result = if kind == 1 {
              resolver.resolve_with_options(
                &specifier,
                from_path,
                SpecifierType::Cjs,
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
                Default::default(),
              )
            };

            match result.result {
              Ok(r) => match r.resolution {
                Resolution::Path(p) => Ok(p.to_string_lossy().into_owned()),
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

        let promise: Value = func.call((
          resolve,
          from.as_str(),
          base.as_str(),
          css.as_str(),
          js_candidates,
        ))?;

        let result = await_promise(ctx, promise)?;
        result
          .as_string()
          .ok_or(rquickjs::Error::Unknown)?
          .to_string()
      },
    )?;

    asset.content = Arc::new(BufferContent::new(result_css.into_bytes()));
    Ok(asset)
  }
}
