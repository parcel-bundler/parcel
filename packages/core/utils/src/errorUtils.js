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

function symlinkPrivilegeWarning() {
  console.error("-----------------------------------")
  console.error("Skipping symbolic link test(s) because you don't have the privilege.");
  console.error("Run tests with Administrator privilege.");
  console.error("If you don't know how, check here: https://bit.ly/2UmWsbD");
  console.error("-----------------------------------")
}

exports.errorToJson = errorToJson;
exports.jsonToError = jsonToError;
exports.symlinkPrivilegeWarning = symlinkPrivilegeWarning;
