// @flow strict-local

export type JSONError = {
  message: string,
  stack?: string,
  name?: string,
  ...
};

export function errorToJson(error: string | Error): JSONError {
  if (typeof error === 'string') {
    return {message: error};
  }

  let jsonError = {
    message: error.message,
    stack: error.stack,
    name: error.name
  };
  // Add all custom codeFrame properties
  Object.keys(error).forEach(key => {
    // $FlowFixMe
    jsonError[key] = error[key];
  });
  return jsonError;
}

export function jsonToError(
  json: ?JSONError
): void | (Error & {[string]: string, ...}) {
  if (json != null) {
    let error = new Error(json.message);
    Object.keys(json).forEach(key => {
      // $FlowFixMe
      error[key] = json[key];
    });
    return error;
  }
}
