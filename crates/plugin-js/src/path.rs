use rquickjs::{
  Ctx, FromJs, Function, Null, Object, Value,
  function::{Opt, Rest, This},
  module::ModuleDef,
};

fn normalize_string(path: &str, allow_above_root: bool) -> String {
  let mut parts: Vec<&str> = Vec::new();
  for part in path.split('/') {
    match part {
      "" | "." => {}
      ".." => {
        if parts.last().is_some_and(|part| *part != "..") {
          parts.pop();
        } else if allow_above_root {
          parts.push("..");
        }
      }
      _ => parts.push(part),
    }
  }
  parts.join("/")
}

fn cwd<'js>(ctx: &Ctx<'js>) -> rquickjs::Result<String> {
  let process: Object = ctx.globals().get("process")?;
  let cwd: Function = process.get("cwd")?;
  cwd.call((This(process),))
}

fn resolve<'js>(ctx: Ctx<'js>, paths: Rest<String>) -> rquickjs::Result<String> {
  let mut resolved = String::new();
  let mut absolute = false;
  for path in paths.0.iter().rev() {
    if path.is_empty() {
      continue;
    }
    if resolved.is_empty() {
      resolved.push_str(path);
    } else {
      resolved = format!("{path}/{resolved}");
    }
    if path.starts_with('/') {
      absolute = true;
      break;
    }
  }
  if !absolute {
    let current = cwd(&ctx)?;
    resolved = if resolved.is_empty() {
      current
    } else {
      format!("{current}/{resolved}")
    };
    absolute = resolved.starts_with('/');
  }
  let normalized = normalize_string(&resolved, !absolute);
  Ok(if absolute {
    if normalized.is_empty() {
      "/".into()
    } else {
      format!("/{normalized}")
    }
  } else if normalized.is_empty() {
    ".".into()
  } else {
    normalized
  })
}

fn normalize(path: String) -> String {
  if path.is_empty() {
    return ".".into();
  }
  let absolute = path.starts_with('/');
  let trailing = path.ends_with('/');
  let mut normalized = normalize_string(&path, !absolute);
  if normalized.is_empty() && !absolute {
    normalized.push('.');
  }
  if trailing && !normalized.is_empty() {
    normalized.push('/');
  }
  if absolute {
    format!("/{normalized}")
  } else {
    normalized
  }
}

fn is_absolute(path: String) -> bool {
  path.starts_with('/')
}

fn join(paths: Rest<String>) -> String {
  let joined = paths
    .0
    .into_iter()
    .filter(|path| !path.is_empty())
    .collect::<Vec<_>>()
    .join("/");
  if joined.is_empty() {
    ".".into()
  } else {
    normalize(joined)
  }
}

fn relative<'js>(ctx: Ctx<'js>, from: String, to: String) -> rquickjs::Result<String> {
  if from == to {
    return Ok(String::new());
  }
  let from = resolve(ctx.clone(), Rest(vec![from]))?;
  let to = resolve(ctx, Rest(vec![to]))?;
  if from == to {
    return Ok(String::new());
  }
  let from: Vec<&str> = from.split('/').filter(|part| !part.is_empty()).collect();
  let to: Vec<&str> = to.split('/').filter(|part| !part.is_empty()).collect();
  let common = from.iter().zip(&to).take_while(|(a, b)| a == b).count();
  let mut output = vec![".."; from.len() - common];
  output.extend_from_slice(&to[common..]);
  Ok(output.join("/"))
}

fn make_long(path: String) -> String {
  path
}

fn dirname(path: String) -> String {
  if path.is_empty() {
    return ".".into();
  }
  let bytes = path.as_bytes();
  let has_root = bytes[0] == b'/';
  let mut end = None;
  let mut matched_slash = true;
  for index in (1..bytes.len()).rev() {
    if bytes[index] == b'/' {
      if !matched_slash {
        end = Some(index);
        break;
      }
    } else {
      matched_slash = false;
    }
  }
  match end {
    None if has_root => "/".into(),
    None => ".".into(),
    Some(1) if has_root => "//".into(),
    Some(end) => path[..end].into(),
  }
}

fn basename<'js>(ctx: Ctx<'js>, path: String, suffix: Opt<Value<'js>>) -> rquickjs::Result<String> {
  let suffix = match suffix.0 {
    None => None,
    Some(value) if value.is_undefined() => None,
    Some(value) => Some(String::from_js(&ctx, value)?),
  };
  Ok(basename_impl(&path, suffix.as_deref()))
}

fn basename_impl(path: &str, suffix: Option<&str>) -> String {
  let trimmed = path.trim_end_matches('/');
  let base = trimmed.rsplit('/').next().unwrap_or("");
  if let Some(suffix) = suffix
    && !suffix.is_empty()
    && base.ends_with(&suffix)
  {
    return base[..base.len() - suffix.len()].into();
  }
  base.into()
}

fn extension_range(path: &str) -> Option<(usize, usize)> {
  let bytes = path.as_bytes();
  let mut start_dot = None;
  let mut start_part = 0;
  let mut end = None;
  let mut matched_slash = true;
  let mut pre_dot_state = 0i8;
  for index in (0..bytes.len()).rev() {
    match bytes[index] {
      b'/' => {
        if !matched_slash {
          start_part = index + 1;
          break;
        }
      }
      b'.' => {
        if end.is_none() {
          matched_slash = false;
          end = Some(index + 1);
        }
        if start_dot.is_none() {
          start_dot = Some(index);
        } else if pre_dot_state != 1 {
          pre_dot_state = 1;
        }
      }
      _ => {
        if end.is_none() {
          matched_slash = false;
          end = Some(index + 1);
        }
        if start_dot.is_some() {
          pre_dot_state = -1;
        }
      }
    }
  }
  let (Some(start_dot), Some(end)) = (start_dot, end) else {
    return None;
  };
  if pre_dot_state == 0
    || (pre_dot_state == 1 && start_dot == end - 1 && start_dot == start_part + 1)
  {
    None
  } else {
    Some((start_dot, end))
  }
}

fn extname(path: String) -> String {
  extension_range(&path)
    .map(|(start, end)| path[start..end].to_owned())
    .unwrap_or_default()
}

fn optional_string(object: &Object<'_>, name: &str) -> rquickjs::Result<String> {
  object
    .get::<_, Option<String>>(name)
    .map(Option::unwrap_or_default)
}

fn format(path: Object<'_>) -> rquickjs::Result<String> {
  let root = optional_string(&path, "root")?;
  let dir = optional_string(&path, "dir")?;
  let base = optional_string(&path, "base")?;
  let name = optional_string(&path, "name")?;
  let ext = optional_string(&path, "ext")?;
  let dir = if dir.is_empty() { &root } else { &dir };
  let base = if base.is_empty() {
    format!("{name}{ext}")
  } else {
    base
  };
  Ok(if dir.is_empty() {
    base
  } else if dir == &root {
    format!("{dir}{base}")
  } else {
    format!("{dir}/{base}")
  })
}

fn parse<'js>(ctx: Ctx<'js>, path: String) -> rquickjs::Result<Object<'js>> {
  let result = Object::new(ctx)?;
  let bytes = path.as_bytes();
  let absolute = bytes.first() == Some(&b'/');
  let scan_start = usize::from(absolute);
  let mut start_dot = None;
  let mut start_part = 0;
  let mut end = None;
  let mut matched_slash = true;
  let mut pre_dot_state = 0i8;

  for index in (scan_start..bytes.len()).rev() {
    match bytes[index] {
      b'/' => {
        if !matched_slash {
          start_part = index + 1;
          break;
        }
      }
      b'.' => {
        if end.is_none() {
          matched_slash = false;
          end = Some(index + 1);
        }
        if start_dot.is_none() {
          start_dot = Some(index);
        } else if pre_dot_state != 1 {
          pre_dot_state = 1;
        }
      }
      _ => {
        if end.is_none() {
          matched_slash = false;
          end = Some(index + 1);
        }
        if start_dot.is_some() {
          pre_dot_state = -1;
        }
      }
    }
  }

  let no_extension = start_dot.is_none()
    || end.is_none()
    || pre_dot_state == 0
    || (pre_dot_state == 1
      && start_dot.is_some_and(|dot| Some(dot + 1) == end && dot == start_part + 1));
  let base_start = if start_part == 0 && absolute {
    1
  } else {
    start_part
  };
  let (base, name, ext) = if let Some(end) = end {
    if no_extension {
      let base = &path[base_start..end];
      (base, base, "")
    } else {
      let start_dot = start_dot.unwrap();
      (
        &path[base_start..end],
        &path[base_start..start_dot],
        &path[start_dot..end],
      )
    }
  } else {
    ("", "", "")
  };
  let dir = if start_part > 0 {
    &path[..start_part - 1]
  } else if absolute {
    "/"
  } else {
    ""
  };
  result.set("root", if absolute { "/" } else { "" })?;
  result.set("dir", dir)?;
  result.set("base", base)?;
  result.set("ext", ext)?;
  result.set("name", name)?;
  Ok(result)
}

pub fn path_module<'js>(ctx: &Ctx<'js>) -> rquickjs::Result<Object<'js>> {
  let module = Object::new(ctx.clone())?;
  module.set("resolve", Function::new(ctx.clone(), resolve)?)?;
  module.set("normalize", Function::new(ctx.clone(), normalize)?)?;
  module.set("isAbsolute", Function::new(ctx.clone(), is_absolute)?)?;
  module.set("join", Function::new(ctx.clone(), join)?)?;
  module.set("relative", Function::new(ctx.clone(), relative)?)?;
  module.set("_makeLong", Function::new(ctx.clone(), make_long)?)?;
  module.set("dirname", Function::new(ctx.clone(), dirname)?)?;
  module.set("basename", Function::new(ctx.clone(), basename)?)?;
  module.set("extname", Function::new(ctx.clone(), extname)?)?;
  module.set("format", Function::new(ctx.clone(), format)?)?;
  module.set("parse", Function::new(ctx.clone(), parse)?)?;
  module.set("sep", "/")?;
  module.set("delimiter", ":")?;
  module.set("win32", Null)?;
  module.set("posix", module.clone())?;
  Ok(module)
}

pub struct PathModule;

impl ModuleDef for PathModule {
  fn declare<'js>(declarations: &rquickjs::module::Declarations<'js>) -> rquickjs::Result<()> {
    for name in [
      "default",
      "resolve",
      "normalize",
      "isAbsolute",
      "join",
      "relative",
      "_makeLong",
      "dirname",
      "basename",
      "extname",
      "format",
      "parse",
      "sep",
      "delimiter",
      "win32",
      "posix",
    ] {
      declarations.declare(name)?;
    }
    Ok(())
  }

  fn evaluate<'js>(
    ctx: &Ctx<'js>,
    exports: &rquickjs::module::Exports<'js>,
  ) -> rquickjs::Result<()> {
    let module = path_module(ctx)?;
    exports.export("default", module.clone())?;
    for name in [
      "resolve",
      "normalize",
      "isAbsolute",
      "join",
      "relative",
      "_makeLong",
      "dirname",
      "basename",
      "extname",
      "format",
      "parse",
      "sep",
      "delimiter",
      "win32",
      "posix",
    ] {
      exports.export(name, module.get::<_, Value>(name)?)?;
    }
    Ok(())
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn extension_cases_match_node() {
    for (path, expected) in [
      ("index.html", ".html"),
      ("index.", "."),
      (".index", ""),
      (".index.md", ".md"),
      ("index..", "."),
      ("..", ""),
      ("...", "."),
      ("/a/b/", ""),
    ] {
      assert_eq!(extname(path.into()), expected, "{path}");
    }
  }

  #[test]
  fn basic_normalization_matches_posix_path() {
    assert_eq!(normalize("/a//b/../c/".into()), "/a/c/");
    assert_eq!(normalize("../../a".into()), "../../a");
    assert_eq!(join(Rest(vec!["/a".into(), "../b".into()])), "/b");
    assert_eq!(dirname("/a/b/".into()), "/a");
    assert_eq!(basename_impl("/a/file.tar.gz", Some(".gz")), "file.tar");
  }
}
