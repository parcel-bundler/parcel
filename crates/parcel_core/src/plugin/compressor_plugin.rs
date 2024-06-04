use std::fmt::Debug;
use std::fs::File;

pub struct CompressedFile {
  /// An optional file extension appended to the output file
  ///
  /// When no extension is returned, then the returned stream replaces the original file.
  ///
  pub extension: Option<String>,

  /// The compressed file
  pub file: File,
}

/// Compresses the input file stream
pub trait CompressorPlugin: Debug {
  /// Compress the given file
  ///
  /// The file contains the final contents of bundles and sourcemaps as they are being written.
  /// A new stream can be returned, or None to forward compression onto the next plugin.
  ///
  fn compress(&self, file: &File) -> Result<Option<CompressedFile>, String>;
}

#[cfg(test)]
mod tests {
  use super::*;

  #[derive(Debug)]
  struct TestCompressorPlugin {}

  impl CompressorPlugin for TestCompressorPlugin {
    fn compress(&self, _file: &File) -> Result<Option<CompressedFile>, String> {
      todo!()
    }
  }

  #[test]
  fn can_be_defined_in_dyn_vec() {
    let mut compressors = Vec::<Box<dyn CompressorPlugin>>::new();

    compressors.push(Box::new(TestCompressorPlugin {}));

    assert_eq!(compressors.len(), 1);
  }
}
