/* eslint-disable prefer-rest-params */

import getTheme from './get-theme';
// Unpack custom variants, and get correct value for the current theme
function themedVariants(variantProp, variants) {
  return function (props) {
    var theme = getTheme(props);
    if (props && props[variantProp] && variants) {
      var modes = variants[props[variantProp]];
      if (modes && modes[theme.mode]) {
        var value = modes[theme.mode];
        if (value) {
          return value;
        } // TS believes value can be undefined
      }
    }

    return '';
  };
}
export default function themed(modesOrVariant, variantModes) {
  if (typeof modesOrVariant === 'string') {
    return themedVariants(modesOrVariant, variantModes);
  }
  var modes = modesOrVariant;
  return function (props) {
    // Get theme from the user's props
    var theme = getTheme(props);
    // User isn't required to provide both light and dark values
    if (theme.mode in modes) {
      var value = modes[theme.mode]; // TS believes value can be undefined
      if (value) {
        return value;
      }
    }
    return '';
  };
}