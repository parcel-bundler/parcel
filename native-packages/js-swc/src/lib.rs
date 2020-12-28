extern crate napi;
#[macro_use]
extern crate napi_derive;
extern crate swc_ecmascript;
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

use swc_common::comments::SingleThreadedComments;
use swc_common::{FileName, SourceMap, sync::Lrc, DUMMY_SP, chain, Globals, Mark};
use swc_ecmascript::ast;
use swc_ecmascript::ast::{Module};
use swc_ecmascript::parser::lexer::Lexer;
use swc_ecmascript::parser::{Parser, EsConfig, StringInput, Syntax, PResult};
use swc_ecmascript::transforms::resolver::resolver_with_mark;
use swc_ecmascript::visit::{FoldWith};
use swc_ecmascript::transforms::{modules::common_js, helpers, fixer, hygiene, optimization::simplify::expr_simplifier, optimization::simplify::dead_branch_remover};
use swc_ecmascript::codegen::text_writer::JsWriter;

use decl_collector::*;
use dependency_collector::*;
use env_replacer::*;
use global_replacer::GlobalReplacer;

#[js_function(1)]
fn transform(ctx: CallContext) -> Result<JsObject> {
  let opts = ctx.get::<JsObject>(0)?;
  let filename_utf8 = opts.get_named_property::<JsString>("filename")?.into_utf8()?;
  let filename = filename_utf8.as_str()?;
  let code_utf8 = opts.get_named_property::<JsString>("code")?.into_utf8()?;
  let code = code_utf8.as_str()?;
  let replace_env: bool = opts.get_named_property::<JsBoolean>("replaceEnv")?.try_into()?;
  let is_browser: bool = opts.get_named_property::<JsBoolean>("isBrowser")?.try_into()?;

  let mut env_map = HashMap::new();
  if replace_env {
    let env = opts.get_named_property::<JsObject>("env")?;
    let names = env.get_property_names::<JsObject>()?;
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
      });
    }
  }

  let module = parse(&code, &filename);

  match module {
    Err(_err) => {
      println!("error");
      Err(Error {
        reason: "an error occurred".into(),
        status: napi::Status::GenericFailure
      })
    },
    Ok((module, source_map, comments)) => {
      let mut module = module;
      let shebang = match module.shebang {
        Some(shebang) => {
          module.shebang = None;
          Some(shebang.to_string())
        },
        None => None
      };

      let mut global_items = vec![];
      let mut items = vec![];

      let program = swc_common::GLOBALS.set(&Globals::new(), || {
        helpers::HELPERS.set(&helpers::Helpers::new(false), || {
          let global_mark = Mark::fresh(Mark::root());
          let module = module.fold_with(&mut resolver_with_mark(global_mark));
          let decls = collect_decls(&module);
    
          let common_js = common_js::common_js(global_mark, swc_ecmascript::transforms::modules::util::Config {
            strict: false,
            strict_mode: false,
            lazy: swc_ecmascript::transforms::modules::util::Lazy::default(),
            no_interop: false,
          });
          
          let mut passes = chain!(
            // Inline process.env and process.browser
            EnvReplacer {
              replace_env,
              env: env_map,
              is_browser,
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
            // Convert ESM to CommonJS
            common_js,
            helpers::inject_helpers(),
            // typescript::strip(),
            fixer(Some(&comments)),
            hygiene(),
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

fn parse(code: &str, filename: &str) -> PResult<(Module, Lrc<SourceMap>, SingleThreadedComments)> {
  let source_map = Lrc::new(SourceMap::default());
  let source_file = source_map.new_source_file(
    FileName::Custom(filename.into()),
    code.into()
  );

  let comments = SingleThreadedComments::default();
  let mut config = EsConfig::default();
  config.dynamic_import = true;

  let lexer = Lexer::new(
    Syntax::Es(config),
    Default::default(),
    StringInput::from(&*source_file),
    Some(&comments),
  );

  let mut parser = Parser::new_from(lexer);
  match parser.parse_module() {
    Err(err) => Err(err),
    Ok(module) => Ok((module, source_map, comments))
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
