// @flow strict-local
import ThrowableDiagnostic from '@parcel/diagnostic';
import {generateJSONCodeHighlights} from '@parcel/codeframe';
// $FlowFixMe untyped
import levenshteinDistance from 'js-levenshtein';

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

function validateSchema(schema: SchemaEntity, data: mixed): Array<SchemaError> {
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
              let results: Array<SchemaError | Array<SchemaError>> = [];
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
              if (results.length)
                return results.reduce((acc, v) => acc.concat(v), []);
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
              if (results.length)
                return results.reduce((acc, v) => acc.concat(v), []);
            }
            break;
          }
        }
      }
    } else if (schemaNode.oneOf) {
      let results: Array<SchemaError | Array<SchemaError>> = [];
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
        return results[0];
      }
    }

    return undefined;
  }

  let result = walk([schema], data, '');
  return Array.isArray(result) ? result : result ? [result] : [];
}
export default validateSchema;

validateSchema.diagnostic = function(
  schema: SchemaEntity,
  data: mixed,
  dataContentsPath?: ?string,
  dataContents: string | mixed,
  origin: string,
  prependKey: string,
  message: string
): void {
  let errors = validateSchema(schema, data);
  if (errors.length) {
    let dataContentsString: string =
      typeof dataContents === 'string'
        ? dataContents
        : // $FlowFixMe
          JSON.stringify(dataContents, null, 2);
    let keys = errors.map(e => {
      let message;
      let {expectedValues, actualValue} = e;
      if (expectedValues) {
        let likely = expectedValues;
        // $FlowFixMe should be a sketchy string check
        if (actualValue) {
          likely = (likely.map(exp => [
            exp,
            levenshteinDistance(exp, actualValue)
          ]): Array<[string, number]>).filter(
            // Remove if more than half of the string would need to be changed
            ([, d]) => d * 2 < actualValue.length
          );
          likely.sort(([, a], [, b]) => a - b);
          likely = likely.map(([v]) => v);
        }
        if (likely.length > 0) {
          message = `Did you mean ${likely
            .map(v => JSON.stringify(v))
            .join(', ')}?`;
        } else if (expectedValues.length > 0) {
          message = `Possible values: ${expectedValues
            .map(v => JSON.stringify(v))
            .join(', ')}`;
        } else {
          message = 'Unknown value';
        }
        // $FlowFixMe should be a sketchy string check
      } else if (e.messagePattern) {
        message = `Expected ${e.messagePattern}`;
      } else if (e.expectedType) {
        message = `Expected type ${e.expectedType.join(' or ')}`;
      }
      return {key: e.dataPath, type: e.type, message};
    });
    let codeFrame = {
      code: dataContentsString,
      codeHighlights: generateJSONCodeHighlights(
        dataContentsString,
        keys.map(({key, type, message}) => ({
          key: prependKey + key,
          type: type,
          message
        }))
      )
    };

    throw new ThrowableDiagnostic({
      diagnostic: {
        message,
        origin,
        // $FlowFixMe should be a sketchy string check
        filePath: dataContentsPath || undefined,
        language: 'json',
        codeFrame
      }
    });
  }
};
