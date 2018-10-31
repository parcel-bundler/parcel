function errorToJson(error) {
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
      jsonError[key] = error[key];
    });
    return jsonError;
  }
}

function jsonToError(json) {
  if (json) {
    let error = new Error(json.message);
    Object.keys(json).forEach(key => {
      error[key] = json[key];
    });
    return error;
  }
}

exports.errorToJson = errorToJson;
exports.jsonToError = jsonToError;
