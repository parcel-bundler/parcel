// @flow strict-local

import {flat} from './';

export type SchemaEntity =
  | SchemaObject
  | SchemaArray
  | SchemaBoolean
  | SchemaString
  | SchemaOneOf;
export type SchemaArray = {|
  type: 'array',
  items?: SchemaEntity,
  __pattern?: string
|};
export type SchemaBoolean = {|
  type: 'boolean',
  __pattern?: string
|};
export type SchemaOneOf = {|
  oneOf: Array<SchemaEntity>,
  __pattern?: string
|};
export type SchemaString = {|
  type: 'string',
  enum: Array<string>,
  __pattern?: string
|};
export type SchemaObject = {|
  type: 'object',
  properties: {|[key: string]: SchemaEntity|},
  additionalProperties: boolean,
  __pattern?: string
|};
export type SchemaError = {|
  type: 'key' | 'value',
  dataPath: string,
  expectedType?: Array<string>,
  actualType?: string,
  expectedValues?: Array<string>,
  actualValue?: string,
  message?: string,
  messagePattern?: string,
  ancestors: Array<SchemaEntity>
|};

export default function(schema: SchemaEntity, data: mixed): Array<SchemaError> {
  function walk(
    schemaAncestors,
    dataNode,
    dataPath
  ): ?SchemaError | Array<SchemaError> {
    let [schemaNode] = schemaAncestors;
    if (schemaNode.type) {
      let type = Array.isArray(dataNode) ? 'array' : typeof dataNode;
      if (schemaNode.type !== type) {
        return {
          type: 'value',
          dataPath,
          expectedType: [schemaNode.type],
          actualType: type,
          ancestors: schemaAncestors,
          messagePattern: schemaNode.__pattern
        };
      } else {
        switch (schemaNode.type) {
          case 'array': {
            if (schemaNode.items) {
              let results = [];
              // $FlowFixMe type was already checked
              for (let i = 0; i < dataNode.length; i++) {
                let result = walk(
                  [schemaNode.items].concat(schemaAncestors),
                  // $FlowFixMe type was already checked
                  dataNode[i],
                  dataPath + '/' + i
                );
                if (result) results.push(result);
              }
              if (results.length) return flat(results);
            }
            break;
          }
          case 'string': {
            // $FlowFixMe type was already checked
            let value: string = dataNode;
            if (schemaNode.enum) {
              if (!schemaNode.enum.includes(value)) {
                return {
                  type: 'value',
                  dataPath,
                  expectedValues: schemaNode.enum,
                  actualValue: value,
                  actualType: 'string',
                  ancestors: schemaAncestors,
                  messagePattern: schemaNode.__pattern
                };
              }
            }
            break;
          }
          case 'object': {
            if (schemaNode.properties) {
              let {additionalProperties = true} = schemaNode;
              let results = [];
              // $FlowFixMe type was already checked
              for (let k in dataNode) {
                if (k in schemaNode.properties) {
                  let result = walk(
                    // $FlowFixMe ??
                    [schemaNode.properties[k]].concat(schemaAncestors),
                    // $FlowFixMe type was already checked
                    dataNode[k],
                    dataPath + '/' + k
                  );
                  if (result) results.push(result);
                } else if (!additionalProperties) {
                  results.push({
                    type: 'key',
                    dataPath: dataPath + '/' + k,
                    expectedValues: Object.keys(schemaNode.properties).filter(
                      // $FlowFixMe type was already checked
                      p => !(p in dataNode)
                    ),
                    actualValue: k,
                    actualType: 'string',
                    ancestors: schemaAncestors,
                    messagePattern: schemaNode.__pattern
                  });
                }
              }
              if (results.length) return flat(results);
            }
            break;
          }
        }
      }
    } else if (schemaNode.oneOf) {
      let results = [];
      for (let f of schemaNode.oneOf) {
        let result = walk([f].concat(schemaAncestors), dataNode, dataPath);
        if (result) results.push(result);
      }
      if (results.length == schemaNode.oneOf.length) {
        // return the result with more values / longer key
        results.sort((a, b) =>
          Array.isArray(a) || Array.isArray(b)
            ? Array.isArray(a) && !Array.isArray(b)
              ? -1
              : !Array.isArray(a) && Array.isArray(b)
              ? 1
              : Array.isArray(a) && Array.isArray(b)
              ? b.length - a.length
              : 0
            : b.dataPath.length - a.dataPath.length
        );
        let x: Array<SchemaError> = results;
        return flat(x[0]);
      }
    }

    return undefined;
  }

  let result = walk([schema], data, '');
  return Array.isArray(result) ? result : result ? [result] : [];
}
