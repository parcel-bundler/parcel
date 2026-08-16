use std::{io::Cursor, sync::Arc};

use fast_image_resize::{IntoImageView, PixelType, ResizeOptions, Resizer, images::Image};
use image::{
  DynamicImage, GrayAlphaImage, GrayImage, ImageDecoder, ImageFormat, ImageReader, RgbImage,
  RgbaImage,
};
use parcel_core::*;

use crate::jpeg::{MozJpegEncoder, optimize_jpeg_lossless};
mod jpeg;

pub struct ImageTransformer {}

impl Transformer for ImageTransformer {
  fn transform(
    &self,
    mut asset: Asset,
    _: &ParcelOptions,
    _fs: &std::sync::Arc<dyn parcel_core::FileSystem>,
  ) -> Result<Asset, DiagnosticList> {
    asset.bundle_behavior = BundleBehavior::Isolated;

    if !asset
      .target
      .flags
      .contains(EnvironmentFlags::SHOULD_OPTIMIZE)
    {
      return Ok(asset);
    }

    let mut width: Option<u32> = None;
    let mut height: Option<u32> = None;
    let mut quality: Option<u8> = None;
    let mut format: Option<AssetType> = None;

    for (key, val) in asset.loc.url.query_pairs() {
      if key == "width" {
        width = val.parse().ok();
      } else if key == "height" {
        height = val.parse().ok();
      } else if key == "quality" {
        quality = val.parse().ok();
      } else if key == "as" {
        format = match &*val {
          "png" => Some(AssetType::Png),
          "jpeg" | "jpg" => Some(AssetType::Jpeg),
          "gif" => Some(AssetType::Gif),
          "webp" => Some(AssetType::WebP),
          "ico" => Some(AssetType::Ico),
          "avif" => Some(AssetType::Avif),
          _ => None,
        }
      }
    }

    if width.is_some() || height.is_some() || quality.is_some() || format.is_some() {
      let bytes = asset.content.read()?;
      let mut reader = ImageReader::new(Cursor::new(bytes));
      reader.set_format(match &asset.ty {
        AssetType::Png => ImageFormat::Png,
        AssetType::Jpeg => ImageFormat::Jpeg,
        AssetType::Gif => ImageFormat::Gif,
        AssetType::WebP => ImageFormat::WebP,
        AssetType::Tiff => ImageFormat::Tiff,
        AssetType::Bmp => ImageFormat::Bmp,
        AssetType::Ico => ImageFormat::Ico,
        AssetType::Avif => ImageFormat::Avif,
        _ => return Ok(asset),
      });

      let mut decoder = reader.into_decoder().unwrap();
      let orientation = decoder.orientation();
      let mut img = DynamicImage::from_decoder(decoder).map_err(|err| Diagnostic {
        message: err.to_string(),
        origin: Some("@parcel/transformer-image".into()),
        code_frames: Vec::new(),
        hints: Vec::new(),
        severity: DiagnosticSeverity::Error,
        documentation_url: None,
      })?;

      if let Ok(orientation) = orientation {
        img.apply_orientation(orientation);
      }

      if width.is_some() || height.is_some() {
        let mut resizer = Resizer::new();
        let w = width.unwrap_or_else(|| {
          ((height.unwrap() as f32) / (img.height() as f32) * (img.width() as f32)) as u32
        });
        let h = height.unwrap_or_else(|| {
          ((width.unwrap() as f32) / (img.width() as f32) * (img.height() as f32)) as u32
        });
        let mut dest_image = Image::new(w, h, img.pixel_type().unwrap());
        resizer
          .resize(
            &img,
            &mut dest_image,
            Some(&ResizeOptions {
              algorithm: fast_image_resize::ResizeAlg::Convolution(
                fast_image_resize::FilterType::Lanczos3,
              ),
              ..Default::default()
            }),
          )
          .unwrap();

        let w = dest_image.width();
        let h = dest_image.height();
        let pixel_type = dest_image.pixel_type();
        let data = dest_image.into_vec();
        img = match pixel_type {
          PixelType::U8 => DynamicImage::ImageLuma8(GrayImage::from_raw(w, h, data).unwrap()),
          PixelType::U8x2 => {
            DynamicImage::ImageLumaA8(GrayAlphaImage::from_raw(w, h, data).unwrap())
          }
          PixelType::U8x3 => DynamicImage::ImageRgb8(RgbImage::from_raw(w, h, data).unwrap()),
          _ => DynamicImage::ImageRgba8(RgbaImage::from_raw(w, h, data).unwrap()),
        };
      }

      let mut output = Cursor::new(Vec::<u8>::with_capacity(
        (img.width() * img.height() * 4) as usize,
      ));

      match format.as_ref().unwrap_or(&asset.ty) {
        AssetType::Png => {
          if asset
            .target
            .flags
            .contains(EnvironmentFlags::SHOULD_OPTIMIZE)
          {
            let png = oxipng::RawImage::new(
              img.width(),
              img.height(),
              match img.color() {
                image::ColorType::Rgb8 | image::ColorType::Rgb16 | image::ColorType::Rgb32F => {
                  oxipng::ColorType::RGB {
                    transparent_color: None,
                  }
                }
                image::ColorType::Rgba8 | image::ColorType::Rgba16 | image::ColorType::Rgba32F => {
                  oxipng::ColorType::RGBA
                }
                image::ColorType::L8 | image::ColorType::L16 => oxipng::ColorType::Grayscale {
                  transparent_shade: None,
                },
                image::ColorType::La8 | image::ColorType::La16 => oxipng::ColorType::GrayscaleAlpha,
                _ => unreachable!(),
              },
              match img.color() {
                image::ColorType::Rgb8
                | image::ColorType::Rgba8
                | image::ColorType::L8
                | image::ColorType::La8 => oxipng::BitDepth::Eight,
                image::ColorType::Rgb16
                | image::ColorType::Rgba16
                | image::ColorType::L16
                | image::ColorType::La16 => oxipng::BitDepth::Sixteen,
                _ => unreachable!(),
              },
              img.into_bytes(),
            )
            .unwrap();
            let res = png.create_optimized_png(&Default::default()).unwrap();
            *output.get_mut() = res;
          } else {
            img
              .write_with_encoder(image::codecs::png::PngEncoder::new(&mut output))
              .unwrap();
          }
          Ok(())
        }
        AssetType::Jpeg => {
          img.write_with_encoder(MozJpegEncoder::new(&mut output, quality.unwrap_or(80)))
        }
        AssetType::Gif => img.write_with_encoder(image::codecs::gif::GifEncoder::new(&mut output)),
        AssetType::WebP => {
          // Built-in webp encoder in the `image` crate only supports lossless, so we use libwebp.
          let mem = webp::Encoder::from_image(&img)
            .unwrap()
            .encode(quality.unwrap_or(80) as f32);
          output.get_mut().extend_from_slice(&mem);
          Ok(())
        }
        AssetType::Avif => {
          img.write_with_encoder(image::codecs::avif::AvifEncoder::new_with_speed_quality(
            &mut output,
            4,
            quality.unwrap_or(80),
          ))
        }
        format => {
          return Err(
            Diagnostic::from_message(format!("unsupported image format {}", format.extension()))
              .into(),
          );
        }
      }
      .unwrap();

      asset.content = Arc::new(BufferContent::new(output.into_inner()));
      if let Some(format) = format {
        asset.ty = format;
      }
    } else if asset
      .target
      .flags
      .contains(EnvironmentFlags::SHOULD_OPTIMIZE)
    {
      match &asset.ty {
        AssetType::Png => {
          let bytes = asset.content.read()?;
          let result = oxipng::optimize_from_memory(&bytes, &Default::default()).unwrap_or(bytes);
          asset.content = Arc::new(BufferContent::new(result));
        }
        AssetType::Jpeg => {
          let bytes = asset.content.read()?;
          let result = optimize_jpeg_lossless(&bytes).unwrap_or(bytes);
          asset.content = Arc::new(BufferContent::new(result));
        }
        _ => {}
      }
    }

    Ok(asset)
  }
}
