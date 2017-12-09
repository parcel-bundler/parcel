let serverErrorList = {
  EACCES: "You don't have access to bind the server to port {port}.",
  EADDRINUSE: 'There is already a process listening on port {port}.'
};

function serverErrors(err, port) {
  let desc = serverErrorList[err.code].replace(/{port}/g, port);
  if (!desc) {
    desc = `Error: ${
      err.code
    } occurred while setting up server on port ${port}.`;
  }
  return desc;
}

module.exports.serverErrors = serverErrors;
