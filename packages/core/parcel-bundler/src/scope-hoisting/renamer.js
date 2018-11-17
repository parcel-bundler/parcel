function rename(scope, oldName, newName) {
  if (oldName === newName) {
    return;
  }

  scope.rename(oldName, newName);
}

module.exports = rename;
