extern crate napi;
#[macro_use]
extern crate napi_derive;
extern crate swc_ecmascript;
extern crate swc_ecma_preset_env;
extern crate swc_common;
#[macro_use]
extern crate swc_atoms;

mod decl_collector;
mod dependency_collector;
mod env_replacer;
mod global_replacer;
mod utils;

use std::convert::TryInto;
use napi::{CallContext, JsString, JsObject, JsBoolean, Result, Error};
use std::collections::{HashMap};
use std::str::FromStr;

use swc_common::comments::SingleThreadedComments;
use swc_common::{FileName, SourceMap, sync::Lrc, DUMMY_SP, chain, Globals, Mark};
use swc_common::errors::{ColorConfig, Handler};
use swc_ecmascript::ast;
use swc_ecmascript::ast::{Module};
use swc_ecmascript::parser::lexer::Lexer;
use swc_ecmascript::parser::{Parser, EsConfig, TsConfig, StringInput, Syntax, PResult};
use swc_ecmascript::transforms::resolver::resolver_with_mark;
use swc_ecmascript::visit::{FoldWith};
use swc_ecmascript::transforms::{
  modules::common_js,
  helpers,
  fixer,
  hygiene,
  optimization::simplify::expr_simplifier,
  optimization::simplify::dead_branch_remover,
  react,
  typescript,
  pass::Optional
};
use swc_ecmascript::codegen::text_writer::JsWriter;
use swc_ecma_preset_env::{preset_env, Targets, Versions, Version, Mode::Entry};

use decl_collector::*;
use dependency_collector::*;
use env_replacer::*;
use global_replacer::GlobalReplacer;

struct Config {
  replace_env: bool,
  env_map: HashMap<swc_atoms::JsWord, ast::Str>,
  is_browser: bool,
  is_type_script: bool,
  is_jsx: bool,
  jsx_pragma: Option<String>,
  jsx_pragma_frag: Option<String>,
  is_development: bool,
  targets: Option<Versions>
}

fn get_optional_str(obj: &JsObject, name: &str) -> Option<String> {
  let val = obj.get_named_property::<JsString>(name);
  if let Ok(val) = val {
    if let Ok(val) = val.into_utf8() {
      let str = val.as_str();
      if let Ok(val) = str {
        return Some(val.to_string())
      }
    }
  }

  None
}

fn targets_to_versions(targets: Result<JsObject>) -> Option<Versions> {
  if let Ok(targets) = targets {
    macro_rules! set_target {
      ($versions: ident, $name: ident) => {
        let version = targets.get_named_property::<JsString>(stringify!($name));
        if let Ok(version) = version {
          if let Ok(utf8) = version.into_utf8() {
            if let Ok(str) = utf8.as_str() {
              if let Ok(version) = Version::from_str(str) {
                $versions.$name = Some(version);
              }
            }
          }
        }
      };
    }

    let mut versions = Versions::default();
    set_target!(versions, chrome);
    set_target!(versions, opera);
    set_target!(versions, edge);
    set_target!(versions, firefox);
    set_target!(versions, safari);
    set_target!(versions, ie);
    set_target!(versions, ios);
    set_target!(versions, android);
    set_target!(versions, node);
    set_target!(versions, electron);
    return Some(versions)
  }

  None
}

#[js_function(1)]
fn transform(ctx: CallContext) -> Result<JsObject> {
  let opts = ctx.get::<JsObject>(0)?;
  let filename_utf8 = opts.get_named_property::<JsString>("filename")?.into_utf8()?;
  let filename = filename_utf8.as_str()?;
  let code_utf8 = opts.get_named_property::<JsString>("code")?.into_utf8()?;
  let code = code_utf8.as_str()?;
  let replace_env: bool = opts.get_named_property::<JsBoolean>("replaceEnv")?.try_into()?;
  let is_browser: bool = opts.get_named_property::<JsBoolean>("isBrowser")?.try_into()?;
  let is_type_script: bool = opts.get_named_property::<JsBoolean>("isTypeScript")?.try_into()?;
  let is_jsx: bool = opts.get_named_property::<JsBoolean>("isJSX")?.try_into()?;
  let is_development: bool = opts.get_named_property::<JsBoolean>("isDevelopment")?.try_into()?;
  let targets = opts.get_named_property::<JsObject>("targets");

  let mut env_map = HashMap::new();
  if replace_env {
    let env = opts.get_named_property::<JsObject>("env")?;
    let names = env.get_property_names()?;
    for i in 0..names.get_array_length()? {
      let name = names.get_element::<JsString>(i)?;
      let n_utf8 = name.into_utf8()?;
      let n_str = n_utf8.as_str()?;
      let val = env.get_property::<JsString, JsString>(&name)?.into_utf8()?;
      let val_str = val.as_str()?;
      env_map.insert(swc_atoms::JsWord::from(n_str), ast::Str {
        span: DUMMY_SP,
        value: val_str.into(),
        has_escape: false,
        kind: ast::StrKind::Synthesized
      });
    }
  }

  let config = Config {
    replace_env,
    env_map,
    is_browser,
    is_type_script,
    is_jsx,
    jsx_pragma: get_optional_str(&opts, "jsxPragma"),
    jsx_pragma_frag: get_optional_str(&opts, "jsxPragmaFrag"),
    is_development,
    targets: targets_to_versions(targets)
  };

  let source_map = Lrc::new(SourceMap::default());
  let module = parse(&code, &filename, &source_map, &config);

  match module {
    Err(_err) => {
      let handler = Handler::with_tty_emitter(ColorConfig::Auto, true, false, Some(source_map.clone()));
      _err.into_diagnostic(&handler).emit();
      Err(Error {
        reason: "an error occurred".into(),
        status: napi::Status::GenericFailure
      })
    },
    Ok((module, comments)) => {
      let mut module = module;
      let shebang = match module.shebang {
        Some(shebang) => {
          module.shebang = None;
          Some(shebang.to_string())
        },
        None => None
      };

      let mut global_items = vec![];
      let mut items: Vec<DependencyDescriptor> = vec![];

      let program = swc_common::GLOBALS.set(&Globals::new(), || {
        helpers::HELPERS.set(&helpers::Helpers::new(false), || {
          let mut react_options = react::Options::default();
          if config.is_jsx {
            if let Some(jsx_pragma) = config.jsx_pragma {
              react_options.pragma = jsx_pragma;
            }
            if let Some(jsx_pragma_frag) = config.jsx_pragma_frag {
              react_options.pragma_frag = jsx_pragma_frag;
            }
            react_options.development = config.is_development;
          }

          let mut passes = chain!(
            Optional::new(react::jsx(source_map.clone(), Some(&comments), react_options), is_jsx),
            Optional::new(typescript::strip(), is_type_script)
          );

          module = module.fold_with(&mut passes);

          let global_mark = Mark::fresh(Mark::root());
          let module = module.fold_with(&mut resolver_with_mark(global_mark));
          let decls = collect_decls(&module);
    
          let common_js = common_js::common_js(global_mark, swc_ecmascript::transforms::modules::util::Config {
            strict: false,
            strict_mode: false,
            lazy: swc_ecmascript::transforms::modules::util::Lazy::default(),
            no_interop: false,
          });

          let mut preset_env_config = swc_ecma_preset_env::Config::default();
          if let Some(versions) = config.targets {
            preset_env_config.targets = Some(Targets::Versions(versions));
            preset_env_config.shipped_proposals = true;
            preset_env_config.mode = Some(Entry);
          }
          
          let mut passes = chain!(
            // Inline process.env and process.browser
            EnvReplacer {
              replace_env: config.replace_env,
              env: config.env_map,
              is_browser: config.is_browser,
              decls: &decls,
            },
            // Simplify expressions and remove dead branches so that we
            // don't include dependencies inside conditionals that are always false.
            expr_simplifier(),
            dead_branch_remover(),
            // Insert dependencies for node globals
            GlobalReplacer {
              source_map: &source_map,
              items: &mut global_items,
              globals: HashMap::new(),
              filename,
              decls: &decls,
              global_mark
            },
            // Collect dependencies
            dependency_collector(&source_map, &mut items, &decls),
            // Transpile new syntax to older syntax if needed
            Optional::new(preset_env(global_mark, preset_env_config), config.targets.is_some()),
            // Convert ESM to CommonJS
            common_js,
            helpers::inject_helpers(),
            hygiene(),
            fixer(Some(&comments)),
          );

          module.fold_with(&mut passes)
        })
      });

      items.extend(global_items);

      let (buf, _src_map_buf) = emit(source_map, comments, &program)?;
      let mut items_arr = ctx.env.create_array()?;
      let mut i = 0;
      for item in items {
        let mut item_obj = ctx.env.create_object()?;
        let kind = ctx.env.create_string_from_std(item.kind.to_string())?;
        let specifier = ctx.env.create_string_from_std(item.specifier.to_string())?;
        let mut start = ctx.env.create_object()?;
        start.set_named_property("line", ctx.env.create_uint32(item.start_line as u32)?)?;
        start.set_named_property("column", ctx.env.create_uint32(item.start_col as u32)?)?;
        let mut end = ctx.env.create_object()?;
        end.set_named_property("line", ctx.env.create_uint32(item.end_line as u32)?)?;
        end.set_named_property("column", ctx.env.create_uint32(item.end_col as u32)?)?;
        let mut loc = ctx.env.create_object()?;
        loc.set_named_property("start", start)?;
        loc.set_named_property("end", end)?;
        item_obj.set_named_property("kind", kind)?;
        item_obj.set_named_property("specifier", specifier)?;
        item_obj.set_named_property("loc", loc)?;

        if let Some(attributes) = item.attributes {
          let mut attrs = ctx.env.create_object()?;
          for (key, val) in attributes {
            attrs.set_named_property(&key, ctx.env.get_boolean(val)?)?;
          }
          item_obj.set_named_property("attributes", attrs)?;
        }

        item_obj.set_named_property("isOptional", ctx.env.get_boolean(item.is_optional)?)?;

        items_arr.set_element(i, item_obj)?;
        i += 1;
      }

      let mut obj = ctx.env.create_object()?;
      obj.set_named_property("dependencies", items_arr)?;

      let code = ctx.env.create_string_from_std(String::from_utf8(buf).unwrap())?;
      obj.set_named_property("code", code)?;

      if let Some(shebang) = shebang {
        let shebang = ctx.env.create_string_from_std(shebang)?;
        obj.set_named_property("shebang", shebang)?;
      }

      Ok(obj)
    }
  }
}

fn parse(code: &str, filename: &str, source_map: &Lrc<SourceMap>, config: &Config) -> PResult<(Module, SingleThreadedComments)> {
  let source_file = source_map.new_source_file(
    FileName::Custom(filename.into()),
    code.into()
  );

  let comments = SingleThreadedComments::default();
  let syntax = if config.is_type_script {
    let mut tsconfig = TsConfig::default();
    tsconfig.tsx = config.is_jsx;
    Syntax::Typescript(tsconfig)
  } else {
    let mut esconfig = EsConfig::default();
    esconfig.jsx = config.is_jsx;
    Syntax::Es(esconfig)
  };

  let lexer = Lexer::new(
    syntax,
    Default::default(),
    StringInput::from(&*source_file),
    Some(&comments),
  );

  let mut parser = Parser::new_from(lexer);
  match parser.parse_module() {
    Err(err) => Err(err),
    Ok(module) => Ok((module, comments))
  }
}

fn emit(source_map: Lrc<SourceMap>, comments: SingleThreadedComments, program: &Module) -> Result<(Vec<u8>, Vec<(swc_common::BytePos, swc_common::LineCol)>)> {
  let mut src_map_buf = vec![];
  let mut buf = vec![];
  {
    let writer = Box::new(
      JsWriter::new(
        source_map.clone(),
        "\n",
        &mut buf,
        Some(&mut src_map_buf),
      )
    );
    let config = swc_ecmascript::codegen::Config { minify: false };
    let mut emitter = swc_ecmascript::codegen::Emitter {
      cfg: config,
      comments: Some(&comments),
      cm: source_map.clone(),
      wr: writer,
    };
    
    emitter.emit_module(&program)?;
  }

  return Ok((buf, src_map_buf));
}

#[module_exports]
fn init(mut exports: JsObject) -> Result<()> {
  exports.create_named_method("transform", transform)?;

  Ok(())
}
