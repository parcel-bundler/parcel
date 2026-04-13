use std::{path::Path, sync::Arc};

use parcel_core::FileSystem;
use rquickjs::{
  Ctx, FromAtom, JsLifetime, Value,
  class::{Trace, Tracer},
  module::ModuleDef,
};

#[derive(JsLifetime, Clone)]
#[rquickjs::class]
pub struct Fs {
  fs: Arc<dyn FileSystem>,
}

impl Fs {
  pub fn new(fs: Arc<dyn FileSystem>) -> Fs {
    Fs { fs }
  }
}

impl<'js> Trace<'js> for Fs {
  fn trace<'a>(&self, _tracer: Tracer<'a, 'js>) {}
}

pub struct FsModule {}

impl ModuleDef for FsModule {
  fn declare<'js>(decl: &rquickjs::module::Declarations<'js>) -> rquickjs::Result<()> {
    decl.declare("readFileSync")?;
    Ok(())
  }

  fn evaluate<'js>(
    ctx: &rquickjs::Ctx<'js>,
    exports: &rquickjs::module::Exports<'js>,
  ) -> rquickjs::Result<()> {
    let fs = ctx.userdata::<Fs>().unwrap();
    exports.export("default", fs.clone())?;
    Ok(())
  }
}

#[rquickjs::methods(rename_all = "camelCase")]
impl Fs {
  pub fn read_file_sync<'js>(&self, ctx: Ctx<'js>, path: String) -> rquickjs::Result<Value<'js>> {
    // TODO: support encodings / buffers
    let contents = self.fs.read_to_string(Path::new(&path));
    match contents {
      Ok(contents) => Ok(rquickjs::String::from_str(ctx, &contents)?.into_value()),
      Err(err) => Err(rquickjs::Exception::throw_message(&ctx, &err.to_string())),
    }
  }
}

pub fn get_dirname<'js>(ctx: Ctx<'js>) -> rquickjs::Result<Value<'js>> {
  let from = ctx.script_or_module_name(0).unwrap();
  let from = from.to_string().unwrap();
  let path = Path::new(&from);
  let parent = path.parent().unwrap().to_str().unwrap();
  Ok(rquickjs::String::from_str(ctx, parent)?.into_value())
}

pub fn get_filename<'js>(ctx: Ctx<'js>) -> rquickjs::Result<Value<'js>> {
  let from = ctx.script_or_module_name(0).unwrap();
  Ok(rquickjs::String::from_atom(from)?.into_value())
}
