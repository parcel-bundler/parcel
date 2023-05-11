/* eslint-disable @atlaskit/design-system/ensure-design-token-usage */

import themed from './utils/themed';

export var background = themed({
  light: "var(--ds-surface, ".concat('b', ")"),
  dark: "var(--ds-surface, ".concat('b', ")")
});


export var skeleton = function skeleton() {
  return "var(--ds-skeleton, ".concat(N20A, ")");
};