// @flow

const MODULE_REGEX = /((@[^/\s]+\/){0,1}([^/@\s]+)){1}(@[^/\s]+){0,1}/;

export default function validateModuleSpecifiers(
  modules: Array<string>
): Array<string> {
  return modules.map(module => {
    // $FlowFixMe, not sure why this happens
    return MODULE_REGEX.exec(module)[0] || '';
  });
}
