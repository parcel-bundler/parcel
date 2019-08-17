// @flow

const MODULE_REGEX = /^((@[^/\s]+\/){0,1}([^/\s.~]+[^/\s]*)){1}(@[^/\s]+){0,1}/;

export default function validateModuleSpecifiers(
  modules: Array<string>
): Array<string> {
  return modules.map(module => {
    let matches = MODULE_REGEX.exec(module);
    if (matches) {
      return matches[0];
    }

    return '';
  });
}
