//! Converts the `Diagnostic` errors of `@parcel/plugin` to core diagnostics.

use std::path::Path;

use parcel_core::{
  AssetType, CodeFrame, CodeHighlight, Diagnostic, DiagnosticSeverity, Location, PathId, SourceUrl,
};
use rquickjs::{Array, Coerced, Ctx, FromJs, Function, Object, Symbol, Value};

/// The symbol a `Diagnostic` error exposes its diagnostics under. Registered with `Symbol.for`,
/// so that every copy of `@parcel/plugin` agrees on it.
const DIAGNOSTICS: &str = "parcel-diagnostics";

/// An `Error` carrying `diagnostics` the way a `Diagnostic` from `@parcel/plugin` does: as its
/// `diagnostics`, and under the symbol Parcel reads them from, so that throwing it, or a plugin
/// rethrowing it, reports them unchanged.
pub(crate) fn diagnostics_error<'js>(
  ctx: &Ctx<'js>,
  diagnostics: &[Diagnostic],
) -> rquickjs::Result<Value<'js>> {
  let message = diagnostics
    .iter()
    .map(|diagnostic| diagnostic.message.as_str())
    .collect::<Vec<_>>()
    .join("\n");
  let error = rquickjs::Exception::from_message(ctx.clone(), &message)?;
  let list = crate::plugin::diagnostics_to_js(ctx, diagnostics)?;
  error.set("name", "Diagnostic")?;
  error.set("diagnostics", list.clone())?;
  let symbol_for: Function = ctx.globals().get::<_, Object>("Symbol")?.get("for")?;
  let key: Symbol = symbol_for.call((DIAGNOSTICS,))?;
  error.set(key, list)?;
  Ok(error.into_value())
}

/// Returns the diagnostics of `value` if it is a `Diagnostic` from `@parcel/plugin`. Those that
/// don't set a severity get `severity`.
pub(crate) fn diagnostics_from_js<'js>(
  ctx: &Ctx<'js>,
  value: &Value<'js>,
  severity: DiagnosticSeverity,
) -> Option<Vec<Diagnostic>> {
  let object = value.as_object()?;
  let symbol_for: Function = get(ctx, &ctx.globals().get::<_, Object>("Symbol").ok()?, "for")?;
  let key: Symbol = symbol_for.call((DIAGNOSTICS,)).ok()?;
  let diagnostics: Array = get(ctx, object, key)?;
  Some(
    diagnostics
      .iter::<Value>()
      .filter_map(Result::ok)
      .map(|diagnostic| diagnostic_from_js(ctx, &diagnostic, severity.clone()))
      .collect(),
  )
}

/// Converts a `DiagnosticOptions` object.
fn diagnostic_from_js<'js>(
  ctx: &Ctx<'js>,
  value: &Value<'js>,
  severity: DiagnosticSeverity,
) -> Diagnostic {
  let Some(object) = value.as_object() else {
    return Diagnostic {
      severity,
      ..Diagnostic::from_message(string(ctx, value).unwrap_or_default())
    };
  };

  Diagnostic {
    message: get_string(ctx, object, "message").unwrap_or_default(),
    origin: get_string(ctx, object, "origin"),
    code_frames: get_array(ctx, object, "codeFrames")
      .iter()
      .filter_map(|frame| code_frame_from_js(ctx, frame.as_object()?))
      .collect(),
    hints: get_array(ctx, object, "hints")
      .iter()
      .filter_map(|hint| string(ctx, hint))
      .collect(),
    severity: match get_string(ctx, object, "severity").as_deref() {
      Some("warning") => DiagnosticSeverity::Warning,
      Some("sourceError") => DiagnosticSeverity::SourceError,
      Some("info") => DiagnosticSeverity::Info,
      Some("error") => DiagnosticSeverity::Error,
      _ => severity,
    },
    documentation_url: get_string(ctx, object, "documentationURL"),
  }
}

fn code_frame_from_js<'js>(ctx: &Ctx<'js>, object: &Object<'js>) -> Option<CodeFrame> {
  // A file the code frame can be read from and reported at: an absolute `filePath`, as in
  // Parcel 2, or a `file:` URL, as in the diagnostics given to reporters.
  let url = get_string(ctx, object, "filePath")
    .filter(|path| Path::new(path).is_absolute())
    .map(|path| SourceUrl::from_path(&PathId::new(Path::new(&path))))
    .or_else(|| {
      get_string(ctx, object, "url")
        .and_then(|url| SourceUrl::parse(&url).ok())
        .filter(|url| url.to_file_path().is_ok())
    });

  Some(CodeFrame {
    code: get_string(ctx, object, "code"),
    url,
    language: get_string(ctx, object, "language").map(|ext| AssetType::from_extension(&ext)),
    code_highlights: get_array(ctx, object, "codeHighlights")
      .iter()
      .filter_map(|highlight| {
        let highlight = highlight.as_object()?;
        let start = location_from_js(ctx, highlight, "start")?;
        Some(CodeHighlight {
          message: get_string(ctx, highlight, "message"),
          end: location_from_js(ctx, highlight, "end").unwrap_or_else(|| start.clone()),
          start,
        })
      })
      .collect(),
  })
}

fn location_from_js<'js>(ctx: &Ctx<'js>, object: &Object<'js>, key: &str) -> Option<Location> {
  let location: Object = get(ctx, object, key)?;
  Some(Location {
    line: get(ctx, &location, "line")?,
    column: get(ctx, &location, "column")?,
  })
}

/// Reads `object[key]`, or `None` if it is missing or of a different type.
///
/// A getter may throw, so this must not leave an exception pending.
fn get<'js, K, V>(ctx: &Ctx<'js>, object: &Object<'js>, key: K) -> Option<V>
where
  K: rquickjs::IntoAtom<'js>,
  V: FromJs<'js>,
{
  let value: Value = match object.get(key) {
    Ok(value) => value,
    Err(_) => {
      ctx.catch();
      return None;
    }
  };
  if value.is_undefined() || value.is_null() {
    return None;
  }
  V::from_js(ctx, value).ok()
}

fn get_string<'js>(ctx: &Ctx<'js>, object: &Object<'js>, key: &str) -> Option<String> {
  let value: Value = get(ctx, object, key)?;
  string(ctx, &value)
}

fn get_array<'js>(ctx: &Ctx<'js>, object: &Object<'js>, key: &str) -> Vec<Value<'js>> {
  get::<_, Array>(ctx, object, key)
    .map(|array| array.iter().filter_map(Result::ok).collect())
    .unwrap_or_default()
}

fn string<'js>(ctx: &Ctx<'js>, value: &Value<'js>) -> Option<String> {
  match Coerced::<String>::from_js(ctx, value.clone()) {
    Ok(string) => Some(string.0),
    Err(_) => {
      ctx.catch();
      None
    }
  }
}
