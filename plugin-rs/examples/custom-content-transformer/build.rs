fn main() {
  // Parcel's ABI symbols are resolved at load time, not link time.
  #[cfg(target_os = "macos")]
  println!("cargo:rustc-link-arg=-Wl,-undefined,dynamic_lookup");
  #[cfg(target_os = "linux")]
  println!("cargo:rustc-link-arg=-Wl,--allow-shlib-undefined");
}
