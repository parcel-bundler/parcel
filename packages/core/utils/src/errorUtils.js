// @flow

type JsonError = {
  message: string
};

type DetailedJsonError = JsonError & {
  stack: string,
  name: string
};

declare function errorToJson(error: string): JsonError;
declare function errorToJson(error: Error): DetailedJsonError;
declare function errorToJson(error: any): any;

export function errorToJson(error) {
  if (typeof error === 'string') {
    return {message: error};
  }

  if (error instanceof Error) {
    let jsonError = {
      message: error.message,
      stack: error.stack,
      name: error.name
    };
    // Add all custom codeFrame properties
    Object.keys(error).forEach(key => {
      (jsonError: any)[key] = (error: any)[key];
    });
    return jsonError;
  }
}

declare function jsonToError(json?: void | null): null;
declare function jsonToError<T>(json: T): Error & T;

export function jsonToError(json) {
  if (json) {
    let error = new Error(json.message);
    Object.keys(json).forEach(key => {
      (error: any)[key] = json[key];
    });
    return error;
  }

  return null;
}
