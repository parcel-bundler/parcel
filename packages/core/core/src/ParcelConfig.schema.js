// @flow strict-local
import type {FilePath} from '@parcel/types';
import type {SchemaEntity} from '@parcel/utils';
import {validatePackageName} from './loadParcelConfig';

const validatePluginName = (
  pluginType: string,
  key: string,
  relativePath: FilePath
) => {
  return (val: string) => {
    // Skip plugin spread...
    if (val === '...') return;

    try {
      validatePackageName(val, pluginType, key, relativePath);
    } catch (e) {
      return e.message;
    }
  };
};

const validateExtends = (relativePath: FilePath) => {
  return (val: string) => {
    // Skip plugin spread...
    if (val.startsWith('.')) return;

    try {
      validatePackageName(val, 'config', 'extends', relativePath);
    } catch (e) {
      return e.message;
    }
  };
};

const pipelineSchema = (
  pluginType: string,
  key: string,
  relativePath: FilePath
): SchemaEntity => {
  return {
    type: 'array',
    items: {
      type: 'string',
      validate: validatePluginName(pluginType, key, relativePath)
    }
  };
};

const mapPipelineSchema = (
  pluginType: string,
  key: string,
  relativePath: FilePath
): SchemaEntity => {
  return {
    type: 'object',
    properties: {},
    additionalProperties: pipelineSchema(pluginType, key, relativePath)
  };
};

const mapStringSchema = (
  pluginType: string,
  key: string,
  relativePath: FilePath
): SchemaEntity => {
  return {
    type: 'object',
    properties: {},
    additionalProperties: {
      type: 'string',
      validate: validatePluginName(pluginType, key, relativePath)
    }
  };
};

export default (relativePath: string): SchemaEntity => {
  return {
    type: 'object',
    properties: {
      extends: {
        oneOf: [
          {
            type: 'string',
            validate: validateExtends(relativePath)
          },
          {
            type: 'array',
            items: {
              type: 'string',
              validate: validateExtends(relativePath)
            }
          }
        ]
      },
      bundler: {
        type: 'string',
        validate: validatePluginName('bundler', 'bundler', relativePath)
      },
      resolvers: pipelineSchema('resolver', 'resolvers', relativePath),
      transforms: mapPipelineSchema('transformer', 'transforms', relativePath),
      validators: mapPipelineSchema('validator', 'validators', relativePath),
      namers: pipelineSchema('namer', 'namers', relativePath),
      packagers: mapStringSchema('packager', 'packagers', relativePath),
      optimizers: mapPipelineSchema('optimizer', 'optimizers', relativePath),
      reporters: pipelineSchema('reporter', 'reporters', relativePath),
      runtimes: mapPipelineSchema('runtime', 'runtimes', relativePath),
      filePath: {
        type: 'string'
      },
      resolveFrom: {
        type: 'string'
      }
    },
    additionalProperties: false
  };
};
