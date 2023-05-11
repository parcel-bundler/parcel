/* eslint-disable prefer-rest-params */

import getTheme from './get-theme';

export default function themed() {
  return function (props) {
    var a = getTheme(props);
    return a;
  };
}