// @flow strict-local
import type {SchemaEntity} from '@parcel/utils';

const PipelineSchema: SchemaEntity = {
  type: 'array',
  items: {
    type: 'string'
  }
};

const MapPipelineSchema: SchemaEntity = {
  type: 'object',
  properties: {},
  additionalProperties: PipelineSchema
};

const MapStringSchema: SchemaEntity = {
  type: 'object',
  properties: {},
  additionalProperties: {
    type: 'string'
  }
};

const ConfigBase: SchemaEntity = {
  type: 'object',
  properties: {
    extends: {
      oneOf: [
        {
          type: 'string'
        },
        {
          type: 'array',
          items: {
            type: 'string'
          }
        }
      ]
    },
    bundler: {
      type: 'string'
    },
    resolvers: PipelineSchema,
    transforms: MapPipelineSchema,
    validators: MapPipelineSchema,
    namers: PipelineSchema,
    packagers: MapStringSchema,
    optimizers: MapPipelineSchema,
    reporters: PipelineSchema,
    runtimes: MapPipelineSchema,
    filePath: {
      type: 'string'
    },
    resolveFrom: {
      type: 'string'
    }
  },
  additionalProperties: false
};

export default ConfigBase;
