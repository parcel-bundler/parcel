use image::ImageEncoder;
use mozjpeg_sys::*;
use std::{io::Cursor, mem, panic::AssertUnwindSafe, ptr, slice};

pub struct MozJpegEncoder<'a> {
  output: &'a mut Cursor<Vec<u8>>,
  quality: u8,
}

impl<'a> MozJpegEncoder<'a> {
  pub fn new(output: &'a mut Cursor<Vec<u8>>, quality: u8) -> Self {
    Self { output, quality }
  }
}

impl<'a> ImageEncoder for MozJpegEncoder<'a> {
  fn write_image(
    self,
    buf: &[u8],
    width: u32,
    height: u32,
    color_type: image::ExtendedColorType,
  ) -> image::ImageResult<()> {
    std::panic::catch_unwind(AssertUnwindSafe(|| -> std::io::Result<()> {
      use image::ExtendedColorType::*;
      let mut comp = mozjpeg::Compress::new(match color_type {
        Rgb1 | Rgb2 | Rgb4 | Rgb8 | Rgb16 | Rgb32F => mozjpeg::ColorSpace::JCS_RGB,
        Rgba1 | Rgba2 | Rgba4 | Rgba8 | Rgba16 | Rgba32F => mozjpeg::ColorSpace::JCS_EXT_RGBA,
        Bgr8 => mozjpeg::ColorSpace::JCS_EXT_BGR,
        Bgra8 => mozjpeg::ColorSpace::JCS_EXT_BGRA,
        L1 | L2 | L4 | L8 | L16 => mozjpeg::ColorSpace::JCS_GRAYSCALE,
        _ => mozjpeg::ColorSpace::JCS_UNKNOWN,
      });
      comp.set_size(width as usize, height as usize);
      comp.set_quality(self.quality as f32);
      let mut comp = comp.start_compress(self.output)?;
      comp.write_scanlines(buf)?;
      comp.finish()?;
      Ok(())
    }))
    .unwrap()
    .unwrap();
    Ok(())
  }
}

// This function losslessly optimizes jpegs.
// Based on the jpegtran.c example program in libjpeg.
pub fn optimize_jpeg_lossless(bytes: &[u8]) -> std::thread::Result<Vec<u8>> {
  std::panic::catch_unwind(|| unsafe {
    let mut srcinfo: jpeg_decompress_struct = mem::zeroed();
    let mut dstinfo: jpeg_compress_struct = mem::zeroed();
    let mut err = create_error_handler();
    srcinfo.common.err = &mut err;
    jpeg_create_decompress(&mut srcinfo);
    jpeg_mem_src(&mut srcinfo, bytes.as_ptr(), bytes.len() as c_ulong);

    dstinfo.optimize_coding = 1;
    dstinfo.common.err = &mut err;
    jpeg_create_compress(&mut dstinfo);
    jpeg_read_header(&mut srcinfo, 1);

    let src_coef_arrays = jpeg_read_coefficients(&mut srcinfo);
    jpeg_copy_critical_parameters(&srcinfo, &mut dstinfo);

    let mut buf = ptr::null_mut();
    let mut outsize: c_ulong = 0;
    jpeg_mem_dest(&mut dstinfo, &mut buf, &mut outsize);

    jpeg_write_coefficients(&mut dstinfo, src_coef_arrays);

    jpeg_finish_compress(&mut dstinfo);
    jpeg_finish_decompress(&mut srcinfo);

    let res = slice::from_raw_parts_mut(buf, outsize as usize);
    let res = res.to_vec();
    jpeg_destroy_decompress(&mut srcinfo);
    jpeg_destroy_compress(&mut dstinfo);
    res
  })
}

unsafe fn create_error_handler() -> jpeg_error_mgr {
  unsafe {
    let mut err: jpeg_error_mgr = mem::zeroed();
    jpeg_std_error(&mut err);
    err.error_exit = Some(unwind_error_exit);
    err.emit_message = Some(silence_message);
    err
  }
}

extern "C-unwind" fn unwind_error_exit(cinfo: &mut jpeg_common_struct) {
  let message = unsafe {
    let err = cinfo.err.as_ref().unwrap();
    match err.format_message {
      Some(fmt) => {
        let buffer = mem::zeroed();
        fmt(cinfo, &buffer);
        let len = buffer.iter().take_while(|&&c| c != 0).count();
        String::from_utf8_lossy(&buffer[..len]).into()
      }
      None => format!("libjpeg error: {}", err.msg_code),
    }
  };
  std::panic::resume_unwind(Box::new(message))
}

extern "C-unwind" fn silence_message(_cinfo: &mut jpeg_common_struct, _level: c_int) {}
