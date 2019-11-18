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
            type: 'string'
          }
        },
        {
          type: 'string'
        }
      ]
    }
  },
  __forbiddenProperties: ['browser'],
  additionalProperties: {
    type: 'string'
  }
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
            __type: 'a wildcard or filepath'
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
    engines: ENGINES_SCHEMA
  },
  additionalProperties: false
}: SchemaEntity);
