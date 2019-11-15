// @flow strict-local
import ThrowableDiagnostic, {
  generateJSONCodeHighlights
} from '@parcel/diagnostic';
// $FlowFixMe untyped
import levenshteinDistance from 'js-levenshtein';

export type SchemaEntity =
  | SchemaObject
  | SchemaArray
  | SchemaBoolean
  | SchemaString
  | SchemaOneOf
  | SchemaAllOf
  | SchemaNot
  | SchemaAny;
export type SchemaArray = {|
  type: 'array',
  items?: SchemaEntity,
  __type?: string,
  __message?: string
|};
export type SchemaBoolean = {|
  type: 'boolean',
  __type?: string,
  __message?: string
|};
export type SchemaOneOf = {|
  oneOf: Array<SchemaEntity>,
  __type?: string,
  __message?: string
|};
export type SchemaAllOf = {|
  allOf: Array<SchemaEntity>,
  __type?: string,
  __message?: string
|};
export type SchemaNot = {|
  not: SchemaEntity,
  __type?: string,
  __message?: string
|};
export type SchemaString = {|
  type: 'string',
  enum?: Array<string>,
  __type?: string,
  __message?: string
|};
export type SchemaObject = {|
  type: 'object',
  properties: {[string]: SchemaEntity, ...},
  additionalProperties?: boolean | SchemaEntity,
  required?: Array<string>,
  __forbiddenProperties?: Array<string>,
  __type?: string,
  __message?: string
|};
export type SchemaAny = {||};
export type SchemaError = {|
  type: ?'key' | 'value',
  dataPath: string,
  expectedType?: Array<string>,
  actualType?: string,
  expectedValues?: Array<string>,
  actualValue?: string,
  forbidden?: boolean,
  message?: string,
  prettyType?: string,
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
          prettyType: schemaNode.__type,
          prettyType: schemaNode.__type,
          message: schemaNode.__message
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
                  prettyType: schemaNode.__type,
                  message: schemaNode.__message
                };
              }
            }
            break;
          }
          case 'object': {
            if (schemaNode.__forbiddenProperties) {
              // $FlowFixMe type was already checked
              let keys = Object.keys(dataNode);
              let foundKeys = schemaNode.__forbiddenProperties.filter(val =>
                keys.includes(val)
              );
              return foundKeys.map(k => ({
                type: null,
                dataPath: dataPath + '/' + k,
                actualValue: k,
                forbidden: true,
                ancestors: schemaAncestors
              }));
            }
            if (schemaNode.required) {
              // $FlowFixMe type was already checked
              let keys = Object.keys(dataNode);
              let missingKeys = schemaNode.required.filter(
                val => !keys.includes(val)
              );
              return missingKeys.map(k => ({
                type: null,
                dataPath,
                message: `Missing required property: ${k}`,
                ancestors: schemaAncestors
              }));
            }
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
                } else {
                  if (typeof additionalProperties === 'boolean') {
                    if (!additionalProperties) {
                      results.push({
                        type: 'key',
                        dataPath: dataPath + '/' + k,
                        expectedValues: Object.keys(
                          schemaNode.properties
                        ).filter(
                          // $FlowFixMe type was already checked
                          p => !(p in dataNode)
                        ),
                        actualValue: k,
                        actualType: 'string',
                        ancestors: schemaAncestors,
                        prettyType: schemaNode.__type,
                        message: schemaNode.__message
                      });
                    }
                  } else {
                    let result = walk(
                      [additionalProperties].concat(schemaAncestors),
                      // $FlowFixMe type was already checked
                      dataNode[k],
                      dataPath + '/' + k
                    );
                    if (result) results.push(result);
                  }
                }
              }
              if (results.length)
                return results.reduce((acc, v) => acc.concat(v), []);
            }
            break;
          }
          case 'boolean':
            // NOOP, type was checked already
            break;
          default:
            throw new Error(`Unimplemented schema type ${type}?`);
        }
      }
    } else if (schemaNode.oneOf || schemaNode.allOf) {
      let list = schemaNode.oneOf || schemaNode.allOf;
      let results: Array<SchemaError | Array<SchemaError>> = [];
      for (let f of list) {
        let result = walk([f].concat(schemaAncestors), dataNode, dataPath);
        if (result) results.push(result);
      }
      if (
        schemaNode.oneOf
          ? results.length == schemaNode.oneOf.length
          : results.length != list.length
      ) {
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
    } else if (schemaNode.not) {
      let result = walk(
        [schemaNode.not].concat(schemaAncestors),
        dataNode,
        dataPath
      );
      if (!result || result.length == 0) {
        return {
          type: null,
          dataPath,
          ancestors: schemaAncestors,
          message: schemaNode.__message
        };
      }
    } else if (Object.keys(schemaNode).length == 0) {
      // "any"
      return undefined;
    } else {
      throw new Error(`Unimplemented schema?`);
    }

    return undefined;
  }

  let result = walk([schema], data, '');
  return Array.isArray(result) ? result : result ? [result] : [];
}
export default validateSchema;

function fuzzySearch(expectedValues: Array<string>, actualValue: string) {
  let result = expectedValues
    .map(exp => [exp, levenshteinDistance(exp, actualValue)])
    .filter(
      // Remove if more than half of the string would need to be changed
      ([, d]) => d * 2 < actualValue.length
    );
  result.sort(([, a], [, b]) => a - b);
  return result.map(([v]) => v);
}

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
          JSON.stringify(dataContents, null, '\t');
    let keys = errors.map(e => {
      let message;
      let {expectedValues, actualValue, type} = e;
      if (expectedValues) {
        let likely =
          actualValue != null ? fuzzySearch(expectedValues, actualValue) : [];

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
      } else if (e.forbidden && actualValue != null) {
        let schemaNode = e.ancestors[0];
        if (schemaNode.type === 'object') {
          let likely = fuzzySearch(
            // $FlowFixMe schemaNode *is* an object
            Object.keys(schemaNode.properties),
            actualValue
          );
          if (likely.length > 0) {
            type = 'key';
            message = `Did you mean ${likely
              .map(v => JSON.stringify(v))
              .join(', ')}?`;
          } else {
            type = 'key';
            message = 'Illegal key';
          }
        } else {
          message = `Illegal key: ${actualValue}`;
        }
      } else if (e.message != null) {
        message = e.message;
      } else if (e.prettyType != null) {
        message = `Expected ${e.prettyType}`;
      } else if (e.expectedType) {
        message = `Expected type ${e.expectedType.join(' or ')}`;
      }
      return {key: e.dataPath, type, message};
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
