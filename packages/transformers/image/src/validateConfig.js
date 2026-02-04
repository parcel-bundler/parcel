// @flow
import type {SchemaEntity} from '@parcel/utils';
import {validateSchema} from '@parcel/utils';

const QUALITY_PROPERTY = {
  type: 'number',
  min: 1,
  max: 100,
  integer: true,
};

// https://sharp.pixelplumbing.com/api-output#jpeg
const JPEG_OUTPUT_SCHEMA: SchemaEntity = {
  type: 'object',
  properties: {
    quality: QUALITY_PROPERTY,
    progressive: {
      type: 'boolean',
    },
    chromaSubsampling: {
      type: 'string',
      enum: ['4:2:0', '4:4:4'],
    },
    optimiseCoding: {
      type: 'boolean',
    },
    optimizeCoding: {
      type: 'boolean',
    },
    mozjpeg: {
      type: 'boolean',
    },
    trellisQuantisation: {
      type: 'boolean',
    },
    overshootDeringing: {
      type: 'boolean',
    },
    optimiseScans: {
      type: 'boolean',
    },
    optimizeScans: {
      type: 'boolean',
    },
    quantisationTable: {
      type: 'number',
      min: 0,
      max: 8,
      integer: true,
    },
    quantizationTable: {
      type: 'number',
      min: 0,
      max: 8,
      integer: true,
    },
    force: {
      type: 'boolean',
    },
  },
  additionalProperties: true,
};

// https://sharp.pixelplumbing.com/api-output#png
const PNG_OUTPUT_SCHEMA: SchemaEntity = {
  type: 'object',
  properties: {
    // yes, for png in specific quality is 0-100. everything else is 1-100
    quality: {
      ...QUALITY_PROPERTY,
      min: 0,
    },
    progressive: {
      type: 'boolean',
    },
    compressionLevel: {
      type: 'number',
      min: 0,
      max: 9,
      integer: true,
    },
    adaptiveFiltering: {
      type: 'boolean',
    },
    palette: {
      type: 'boolean',
    },
    effort: {
      type: 'number',
      min: 1,
      max: 10,
      integer: true,
    },
    colours: {
      type: 'number',
      min: 2,
      max: 256,
      integer: true,
    },
    colors: {
      type: 'number',
      min: 0,
      max: 256,
      integer: true,
    },
    dither: {
      type: 'number',
      min: 0.0,
      max: 1.0,
    },
    force: {
      type: 'boolean',
    },
  },
  additionalProperties: true,
};

const ANIMATED_OPTIONS_SCHEMA = {
  loop: {
    type: 'number',
    min: 0,
    max: 65536,
  },
  // max & integer requirement are undocumented, but sharp will throw an error
  delay: {
    oneOf: [
      {
        type: 'array',
        items: {
          type: 'number',
          min: 0,
          max: 65535,
          integer: true,
        },
      },
      {
        type: 'number',
        min: 0,
        max: 65535,
        integer: true,
      },
    ],
  },
};

// https://sharp.pixelplumbing.com/api-output#webp
const WEBP_OUTPUT_SCHEMA: SchemaEntity = {
  type: 'object',
  properties: {
    quality: QUALITY_PROPERTY,
    alphaQuality: {
      type: 'number',
      min: 0,
      max: 100,
    },
    lossless: {
      type: 'boolean',
    },
    nearLossless: {
      type: 'boolean',
    },
    smartSubsample: {
      type: 'boolean',
    },
    preset: {
      type: 'string',
      enum: ['default', 'photo', 'picture', 'drawing', 'icon', 'text'],
    },
    effort: {
      type: 'number',
      min: 0,
      max: 6,
      integer: true,
    },
    minSize: {
      type: 'boolean',
    },
    mixed: {
      type: 'boolean',
    },
    force: {
      type: 'boolean',
    },
    ...ANIMATED_OPTIONS_SCHEMA,
  },
  additionalProperties: true,
};

// https://sharp.pixelplumbing.com/api-output#gif
const GIF_OUTPUT_SCHEMA: SchemaEntity = {
  type: 'object',
  properties: {
    reuse: {
      type: 'boolean',
    },
    progressive: {
      type: 'boolean',
    },
    colours: {
      type: 'number',
      min: 2,
      max: 256,
      integer: true,
    },
    effort: {
      type: 'number',
      min: 1,
      max: 10,
      integer: true,
    },
    dither: {
      type: 'number',
      min: 0.0,
      max: 1.0,
    },
    interFrameMaxError: {
      type: 'number',
      min: 0,
      max: 32,
    },
    interPaletteMaxError: {
      type: 'number',
      min: 0,
      max: 256,
    },
    loop: {
      type: 'number',
      min: 0,
      max: 65536,
    },
    force: {
      type: 'boolean',
    },
    ...ANIMATED_OPTIONS_SCHEMA,
  },
  additionalProperties: true,
};

// https://sharp.pixelplumbing.com/api-output#tiff
const TIFF_OUTPUT_SCHEMA: SchemaEntity = {
  type: 'object',
  properties: {
    quality: QUALITY_PROPERTY,
    force: {
      type: 'boolean',
    },
    compression: {
      type: 'string',
      enum: [
        'none',
        'jpeg',
        'deflate',
        'packbits',
        'c,cittfax4',
        'lzw',
        'webp',
        'zstd',
        'jp2k',
      ],
    },
    predictor: {
      type: 'string',
      enum: ['none', 'horizontal', 'float'],
    },
    pyramid: {
      type: 'boolean',
    },
    tile: {
      type: 'boolean',
    },
    tileWidth: {
      type: 'number',
      min: 0,
      integer: true,
    },
    tileHeight: {
      type: 'number',
      min: 0,
      integer: true,
    },
    xres: {
      type: 'number',
      min: 0,
    },
    yres: {
      type: 'number',
      min: 0,
    },
    resolutionUnit: {
      type: 'string',
      enum: ['inch', 'cm'],
    },
    bitdepth: {
      type: 'number',
    },
    miniswhite: {
      type: 'boolean',
    },
  },
  additionalProperties: true,
};

const AVIF_HEIF_SHARED_PROPERTIES = {
  quality: QUALITY_PROPERTY,
  lossless: {
    type: 'boolean',
  },
  effort: {
    type: 'number',
    min: 0,
    max: 100,
    integer: true,
  },
  chromaSubsampling: {
    type: 'string',
    enum: ['4:2:0', '4:4:4'],
  },
  bitdepth: {
    type: 'number',
    enum: [8, 10, 12],
  },
};

// https://sharp.pixelplumbing.com/api-output#avif
const AVIF_OUTPUT_SCHEMA: SchemaEntity = {
  type: 'object',
  properties: {
    ...AVIF_HEIF_SHARED_PROPERTIES,
  },
  additionalProperties: true,
};

// https://sharp.pixelplumbing.com/api-output#heif
const HEIF_OUTPUT_SCHEMA: SchemaEntity = {
  type: 'object',
  properties: {
    compression: {
      type: 'string',
      enum: ['av1', 'hevc'],
    },
    ...AVIF_HEIF_SHARED_PROPERTIES,
  },
  additionalProperties: true,
};

const CONFIG_SCHEMA: SchemaEntity = {
  type: 'object',
  properties: {
    // Fallback quality
    quality: QUALITY_PROPERTY,
    jpeg: JPEG_OUTPUT_SCHEMA,
    png: PNG_OUTPUT_SCHEMA,
    webp: WEBP_OUTPUT_SCHEMA,
    gif: GIF_OUTPUT_SCHEMA,
    tiff: TIFF_OUTPUT_SCHEMA,
    avif: AVIF_OUTPUT_SCHEMA,
    heif: HEIF_OUTPUT_SCHEMA,
  },
  additionalProperties: false,
};

export function validateConfig(data: any, filePath: string) {
  validateSchema.diagnostic(
    CONFIG_SCHEMA,
    {data, filePath},
    '@parcel/transformer-image',
    'Invalid sharp config',
  );
}
