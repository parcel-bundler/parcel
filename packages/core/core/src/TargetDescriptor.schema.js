// @flow strict-local
import type {SchemaEntity} from '@parcel/utils';

export const ENGINES_SCHEMA: SchemaEntity = {
  type: 'object',
  properties: {
    browsers: {
      oneOf: [
        {
          type: 'array',
          items: {
            type: 'string',
          },
        },
        {
          type: 'string',
        },
      ],
    },
  },
  __forbiddenProperties: ['browser'],
  additionalProperties: {
    type: 'string',
  },
};

export const DESCRIPTOR_SCHEMA: SchemaEntity = {
  type: 'object',
  properties: {
    context: {
      type: 'string',
      enum: [
        'node',
        'browser',
        'web-worker',
        'electron-main',
        'electron-renderer',
      ],
    },
    includeNodeModules: {
      oneOf: [
        {
          type: 'boolean',
        },
        {
          type: 'array',
          items: {
            type: 'string',
            __type: 'a wildcard or filepath',
          },
        },
        {
          type: 'object',
          properties: {},
          additionalProperties: {
            type: 'boolean',
          },
        },
      ],
    },
    outputFormat: {
      type: 'string',
      enum: ['global', 'esmodule', 'commonjs'],
    },
    distDir: {
      type: 'string',
    },
    publicUrl: {
      type: 'string',
    },
    isLibrary: {
      type: 'boolean',
    },
    sourceMap: {
      oneOf: [
        {
          type: 'boolean',
        },
        {
          type: 'object',
          properties: {
            inlineSources: {
              type: 'boolean',
            },
            sourceRoot: {
              type: 'string',
            },
            inline: {
              type: 'boolean',
            },
          },
          additionalProperties: false,
        },
      ],
    },
    engines: ENGINES_SCHEMA,
    minify: {
      type: 'boolean',
    },
  },
  additionalProperties: false,
};

export const COMMON_TARGET_DESCRIPTOR_SCHEMA: SchemaEntity = {
  oneOf: [
    DESCRIPTOR_SCHEMA,
    {
      enum: [false],
    },
  ],
};
