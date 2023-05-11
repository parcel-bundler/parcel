/* eslint-disable prefer-rest-params */

import getTheme from './get-theme';

export default function themed(modesOrVariant, variantModes) {
  
  return function (props) {
    var a = getTheme(props);
    return a;
  };
}