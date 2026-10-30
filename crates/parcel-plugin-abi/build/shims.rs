//! Generates the C wrappers around `ParcelApi` that plugin.h ends with.
//!
//! Shared by build.rs and the crate's tests, which run it on a synthetic table
//! with functions appended past the first layout: the real table has none until
//! the first alpha is released.

/// The last function in `ParcelApi`'s first published layout. Every host
/// implementing this ABI passes a table at least this long, so plugins call these
/// functions unchecked, while those appended after it are checked against the
/// table's `size` on each call.
///
/// Until the first alpha is released, no plugin has been built against an older
/// table, so this moves to the end of the table with every function added. From
/// the alpha on, it never changes.
pub const FIRST_LAYOUT_END: &str = "diagnostic_get_code_highlight";

/// Appends a `static inline` wrapper for every `ParcelApi` field, so C and Go
/// plugins call `parcel_asset_get_content(...)` exactly as they did when the host
/// exported it as a linkable symbol. The plugin defines `parcel_api` once and
/// points it at the table Parcel passes to `parcel_plugin_init`.
///
/// Functions appended after [`FIRST_LAYOUT_END`] get wrappers that check the
/// table has them, doing nothing and returning zero on a host too old to, plus a
/// `parcel_api_has_*()` predicate that Go and Swift can call where C would use
/// `PARCEL_API_HAS()`.
pub fn add_api_shims(header: &str) -> String {
  add_api_shims_ending_at(header, FIRST_LAYOUT_END)
}

/// [`add_api_shims`], with the first layout ending at `first_layout_end`.
pub fn add_api_shims_ending_at(header: &str, first_layout_end: &str) -> String {
  let body = {
    let start = header
      .find("typedef struct ParcelApi {")
      .expect("ParcelApi missing from generated header");
    let start = header[start..].find('{').unwrap() + start + 1;
    let end = header[start..]
      .find("} ParcelApi;")
      .expect("unterminated ParcelApi")
      + start;
    &header[start..end]
  };

  let mut shims = String::from(
    "\n/**\n * The host functions Parcel passed to `parcel_plugin_init()`. Plugins define this\n\
     \x20* once and assign it before calling anything below.\n */\nextern const struct ParcelApi *parcel_api;\n\n",
  );
  shims.push_str(&format!(
    "/**\n * The end of the last function in the table's first published layout, and so the\n\
     \x20* smallest table any Parcel implementing this ABI passes. Functions declared after\n\
     \x20* `{first_layout_end}` were appended later, and an older Parcel's table ends before them.\n */\n\
     #define PARCEL_API_MIN_SIZE \\\n\
     \x20 (offsetof(struct ParcelApi, {first_layout_end}) + sizeof(((struct ParcelApi *)0)->{first_layout_end}))\n\n"
  ));
  shims.push_str(
    "/**\n * Whether `api` is usable by a plugin built against this header. Check it in\n\
     \x20* `parcel_plugin_init()` before anything else.\n\
     \x20*\n\
     \x20* The ABI version must match: appending never changes the size of an existing\n\
     \x20* field, so a changed signature is invisible to `size`. The table may be smaller\n\
     \x20* than the one declared here, when Parcel predates functions this header appends;\n\
     \x20* their wrappers check for them on each call, so a plugin only needs a newer\n\
     \x20* Parcel if it actually calls one.\n */\n\
     static inline bool parcel_api_compatible(const struct ParcelApiHeader *api) {\n\
     \x20 return api && api->abi == PARCEL_ABI_VERSION && api->size >= PARCEL_API_MIN_SIZE;\n}\n\n\
     /**\n * Whether the table in `parcel_api` has the function `field`. Always true for\n\
     \x20* functions in the first layout. For one appended later, check it before calling,\n\
     \x20* or just call the wrapper, which does nothing and returns zero when Parcel is too\n\
     \x20* old to have it.\n */\n\
     #define PARCEL_API_HAS(field) \\\n\
     \x20 (parcel_api->header.size >= offsetof(struct ParcelApi, field) + sizeof(parcel_api->field))\n\n\
     /**\n * Whether `ptr`, a struct of type `type` that starts with `size`, has room for\n\
     \x20* `field` according to that `size`.\n\
     \x20*\n\
     \x20* Whoever allocates such a struct sets `size` to the size it was built with. Check\n\
     \x20* this before writing a field to one Parcel allocated, such as a `Diagnostic` or\n\
     \x20* `ResolveResult` out-param, and before reading a field from one Parcel filled in,\n\
     \x20* such as a `ReportEvent`, when an older Parcel might not have that field. Fields\n\
     \x20* in the struct's first layout are always there.\n */\n\
     #define PARCEL_HAS_FIELD(ptr, type, field) \\\n\
     \x20 ((ptr)->size >= offsetof(type, field) + sizeof(((type *)0)->field))\n",
  );

  let mut appended = false;
  let mut found_first_layout_end = false;
  for field in split_top_level(body, ';') {
    // Skip doc comments and the leading scalar members.
    let Some(open) = field.find("(*") else {
      continue;
    };
    let close = field[open..].find(')').expect("malformed field") + open;
    let name = field[open + 2..close].trim();
    let ret = field[..open].rsplit("*/").next().unwrap_or("").trim();
    let args_open = field[close..].find('(').expect("field has no arg list") + close;
    let args_close = field.rfind(')').expect("field has no arg list");
    let args = &field[args_open + 1..args_close];

    let args_split = split_top_level(args, ',');
    let names: Vec<&str> = args_split.iter().map(|arg| arg_name(arg)).collect();

    let call = format!("parcel_api->{}({})", name, names.join(", "));
    let call = if ret == "void" {
      format!("  {call};")
    } else {
      format!("  return {call};")
    };
    let args = normalize_ws(args);

    if appended {
      let fallback = if ret == "void" {
        "    return;".to_string()
      } else {
        format!("    {ret} zero = {{0}};\n    return zero;")
      };
      shims.push_str(&format!(
        "\n/** Appended after the first layout: check `parcel_api_has_{name}()`. */\n\
         static inline bool parcel_api_has_{name}(void) {{\n  return PARCEL_API_HAS({name});\n}}\n\
         \n/** Does nothing{} when Parcel is too old to provide it. */\n\
         static inline {ret} parcel_{name}({args}) {{\n  if (!PARCEL_API_HAS({name})) {{\n{fallback}\n  }}\n{call}\n}}\n",
        if ret == "void" { "" } else { " and returns zero" },
      ));
    } else {
      shims.push_str(&format!(
        "\nstatic inline {ret} parcel_{name}({args}) {{\n{call}\n}}\n"
      ));
    }

    if name == first_layout_end {
      found_first_layout_end = true;
      appended = true;
    }
  }
  assert!(
    found_first_layout_end,
    "ParcelApi has no {first_layout_end}, the end of its first layout"
  );

  shims.push_str(&entry_point_prototypes(header));

  let end = header
    .rfind("#endif")
    .expect("header has no include guard end");
  format!("{}{}\n{}", &header[..end], shims, &header[end..])
}

/// Declares the functions a plugin defines, one for each `ParcelPlugin*Fn`
/// typedef: `typedef void (*ParcelPluginTransformFn)(...)` becomes
/// `void parcel_plugin_transform(...)`. A plugin whose definition drifts from the
/// typedef Parcel loads it as then fails to compile.
fn entry_point_prototypes(header: &str) -> String {
  let mut prototypes = String::new();
  let mut rest = header;
  while let Some(start) = rest.find("typedef ") {
    let typedef = &rest[start..];
    let end = typedef.find(';').expect("unterminated typedef");
    rest = &typedef[end..];
    let typedef = normalize_ws(&typedef["typedef ".len()..end]);

    let Some(open) = typedef.find("(*ParcelPlugin") else {
      continue;
    };
    let close = typedef[open..].find(')').expect("malformed typedef") + open;
    let Some(kind) = typedef[open + "(*ParcelPlugin".len()..close].strip_suffix("Fn") else {
      continue;
    };
    let ret = &typedef[..open].trim();
    let args = &typedef[close + 1..];
    prototypes.push_str(&format!(
      "\n{ret} parcel_plugin_{}{args};\n",
      kind.to_lowercase()
    ));
  }
  assert!(
    !prototypes.is_empty(),
    "the header declares no ParcelPlugin*Fn entry points"
  );

  format!(
    "\n/**\n * The entry points a plugin defines, matching the `ParcelPlugin*Fn` types Parcel loads\n\
     \x20* them as. Define those your plugin implements: `parcel_plugin_init()` always, and the\n\
     \x20* rest for each kind of plugin it is used as.\n\
     \x20*\n\
     \x20* Define `PARCEL_NO_ENTRY_POINT_PROTOTYPES` before including this header when the\n\
     \x20* toolchain declares them itself, as cgo does for exported Go functions, with types it\n\
     \x20* cannot spell the same way.\n */\n\
     #ifndef PARCEL_NO_ENTRY_POINT_PROTOTYPES\n{prototypes}\n#endif\n"
  )
}

/// Splits on `sep`, ignoring separators nested inside parentheses or brackets.
fn split_top_level(text: &str, sep: char) -> Vec<String> {
  let mut parts = Vec::new();
  let mut depth = 0;
  let mut current = String::new();
  for c in text.chars() {
    match c {
      '(' | '[' => depth += 1,
      ')' | ']' => depth -= 1,
      _ if c == sep && depth == 0 => {
        parts.push(std::mem::take(&mut current));
        continue;
      }
      _ => {}
    }
    current.push(c);
  }
  if !current.trim().is_empty() {
    parts.push(current);
  }
  parts.into_iter().filter(|p| !p.trim().is_empty()).collect()
}

/// The parameter name of a C declaration: the identifier inside `(*name)` for
/// function pointers and arrays, otherwise the trailing identifier.
fn arg_name(arg: &str) -> &str {
  if let Some(open) = arg.find("(*") {
    let rest = &arg[open + 2..];
    let end = rest
      .find(|c: char| !c.is_alphanumeric() && c != '_')
      .unwrap_or(rest.len());
    return &rest[..end];
  }
  arg
    .trim()
    .rsplit(|c: char| !c.is_alphanumeric() && c != '_')
    .next()
    .unwrap()
}

fn normalize_ws(text: &str) -> String {
  text.split_whitespace().collect::<Vec<_>>().join(" ")
}
