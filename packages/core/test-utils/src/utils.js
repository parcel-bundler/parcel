function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function symlinkPrivilegeWarning() {
  console.error("-----------------------------------")
  console.error("Skipping symbolic link test(s) because you don't have the privilege.");
  console.error("Run tests with Administrator privilege.");
  console.error("If you don't know how, check here: https://bit.ly/2UmWsbD");
  console.error("-----------------------------------")
}

exports.sleep = sleep;
exports.symlinkPrivilegeWarning = symlinkPrivilegeWarning;