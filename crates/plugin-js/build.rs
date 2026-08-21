use std::{
  io::Write,
  path::{Path, PathBuf},
  process::Command,
};

fn main() {
  let status = Command::new("node")
    .arg("buildBuiltins.cjs")
    .status()
    .expect("Failed to run buildBuiltins.cjs");
  assert!(status.success(), "buildBuiltins.cjs exited with {status}");

  embed_builtins();
}

/// Deflate the builtins into OUT_DIR and generate a lookup table for
/// `cjs::Builtins`. This replaces rust-embed's `compression` feature, which
/// dragged in zstd (with its six legacy-format decoders) and libflate — a
/// third deflate implementation — while flate2 is already linked at runtime.
fn embed_builtins() {
  let out_dir = PathBuf::from(std::env::var_os("OUT_DIR").unwrap());
  let mut files = Vec::new();
  collect(Path::new("builtins"), Path::new(""), &mut files);
  // Sorted so the runtime can binary search by path.
  files.sort();

  let mut table = String::from("static BUILTINS: &[(&str, usize, &[u8])] = &[\n");
  for (i, (rel, full)) in files.iter().enumerate() {
    let data = std::fs::read(full).unwrap();
    let mut enc = flate2::write::DeflateEncoder::new(Vec::new(), flate2::Compression::best());
    enc.write_all(&data).unwrap();
    let name = format!("builtin{i}.deflate");
    std::fs::write(out_dir.join(&name), enc.finish().unwrap()).unwrap();
    table.push_str(&format!(
      "  ({:?}, {}, include_bytes!(concat!(env!(\"OUT_DIR\"), \"/{}\"))),\n",
      rel,
      data.len(),
      name
    ));
  }
  table.push_str("];\n");
  std::fs::write(out_dir.join("builtins_gen.rs"), table).unwrap();
}

fn collect(dir: &Path, rel: &Path, out: &mut Vec<(String, PathBuf)>) {
  for entry in std::fs::read_dir(dir).unwrap() {
    let entry = entry.unwrap();
    let path = entry.path();
    let rel = rel.join(entry.file_name());
    if path.is_dir() {
      collect(&path, &rel, out);
    } else {
      out.push((rel.to_str().unwrap().replace('\\', "/"), path));
    }
  }
}
