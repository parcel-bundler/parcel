// @flow strict-local
import type {SchemaEntity} from '@parcel/utils';

const COMMON_ENGINE_PROPERITES = {
  browsers: {
    oneOf: [
      {
        type: 'array',
        items: {
          type: 'string'
        }
      },
      {
        type: 'string'
      }
    ]
  },
  node: {
    oneOf: [
      {
        type: 'array'
      },
      {
        type: 'string'
      }
    ]
  },
  electron: {
    type: 'string'
  }
};

export const TOPLEVEL_ENGINES_SCHEMA: SchemaEntity = {
  type: 'object',
  properties: {
    ...COMMON_ENGINE_PROPERITES,
    parcel: {
      type: 'string'
    },
    npm: {
      type: 'string'
    },
    yarn: {
      type: 'string'
    }
  },
  additionalProperties: false
};

export default ({
  type: 'object',
  properties: {
    context: {
      type: 'string',
      enum: [
        'node',
        'browser',
        'web-worker',
        'electron-main',
        'electron-renderer'
      ]
    },
    includeNodeModules: {
      oneOf: [
        {
          type: 'boolean'
        },
        {
          type: 'array',
          items: {
            type: 'string',
            __pattern: 'a wildcard or filepath'
          }
        }
      ]
    },
    outputFormat: {
      type: 'string',
      enum: ['global', 'esmodule', 'commonjs']
    },
    distDir: {
      type: 'string'
    },
    publicUrl: {
      type: 'string'
    },
    isLibrary: {
      type: 'boolean'
    },
    sourceMap: {
      oneOf: [
        {
          type: 'boolean'
        },
        {
          type: 'object',
          properties: {
            inlineSources: {
              type: 'boolean'
            },
            sourceRoot: {
              type: 'string'
            },
            inline: {
              type: 'boolean'
            }
          },
          additionalProperties: false
        }
      ]
    },
    engines: {
      type: 'object',
      properties: {
        ...COMMON_ENGINE_PROPERITES
      },
      additionalProperties: false
    }
  },
  additionalProperties: false
}: SchemaEntity);
