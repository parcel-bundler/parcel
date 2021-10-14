// @flow
import type {SchemaEntity} from '@parcel/utils';
import {validateSchema} from '@parcel/utils';

// https://sharp.pixelplumbing.com/api-output#jpeg
const JPEG_OUTPUT_SCHEMA: SchemaEntity = {
  type: 'object',
  properties: {
    quality: {
      type: 'number',
    },
    progressive: {
      type: 'boolean',
    },
    chromaSubsampling: {
      type: 'string',
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
    },
    quantizationTable: {
      type: 'number',
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
    quality: {
      type: 'number',
    },
    progressive: {
      type: 'boolean',
    },
    compressionLevel: {
      type: 'number',
    },
    adaptiveFiltering: {
      type: 'boolean',
    },
    palette: {
      type: 'boolean',
    },
    colours: {
      type: 'number',
    },
    colors: {
      type: 'number',
    },
    dither: {
      type: 'number',
    },
    force: {
      type: 'boolean',
    },
  },
  additionalProperties: true,
};

// https://sharp.pixelplumbing.com/api-output#webp
const WEBP_OUTPUT_SCHEMA: SchemaEntity = {
  type: 'object',
  properties: {
    quality: {
      type: 'number',
    },
    alphaQuality: {
      type: 'number',
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
    reductionEffort: {
      type: 'number',
    },
    pageHeight: {
      type: 'number',
    },
    loop: {
      type: 'number',
    },
    delay: {
      type: 'array',
      items: {
        type: 'number',
      },
    },
    force: {
      type: 'boolean',
    },
  },
  additionalProperties: true,
};

// https://sharp.pixelplumbing.com/api-output#gif
const GIF_OUTPUT_SCHEMA: SchemaEntity = {
  type: 'object',
  properties: {
    pageHeight: {
      type: 'number',
    },
    loop: {
      type: 'number',
    },
    delay: {
      type: 'array',
      items: {
        type: 'number',
      },
    },
    force: {
      type: 'boolean',
    },
  },
  additionalProperties: true,
};

// https://sharp.pixelplumbing.com/api-output#tiff
const TIFF_OUTPUT_SCHEMA: SchemaEntity = {
  type: 'object',
  properties: {
    quality: {
      type: 'number',
    },
    force: {
      type: 'boolean',
    },
    compression: {
      type: 'string',
    },
    predictor: {
      type: 'string',
    },
    pyramid: {
      type: 'boolean',
    },
    tile: {
      type: 'boolean',
    },
    tileWidth: {
      type: 'number',
    },
    tileHeight: {
      type: 'number',
    },
    xres: {
      type: 'number',
    },
    yres: {
      type: 'number',
    },
    bitdepth: {
      type: 'number',
    },
  },
  additionalProperties: true,
};

// https://sharp.pixelplumbing.com/api-output#avif
const AVIF_OUTPUT_SCHEMA: SchemaEntity = {
  type: 'object',
  properties: {
    quality: {
      type: 'number',
    },
    lossless: {
      type: 'boolean',
    },
    speed: {
      type: 'number',
    },
    chromaSubsampling: {
      type: 'string',
    },
  },
  additionalProperties: true,
};

// https://sharp.pixelplumbing.com/api-output#heif
const HEIF_OUTPUT_SCHEMA: SchemaEntity = {
  type: 'object',
  properties: {
    quality: {
      type: 'number',
    },
    compression: {
      type: 'string',
    },
    lossless: {
      type: 'boolean',
    },
    speed: {
      type: 'number',
    },
    chromaSubsampling: {
      type: 'string',
    },
  },
  additionalProperties: true,
};

const CONFIG_SCHEMA: SchemaEntity = {
  type: 'object',
  properties: {
    // Fallback quality
    quality: {
      type: 'number',
    },
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
