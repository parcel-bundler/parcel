/* eslint-disable @atlaskit/design-system/ensure-design-token-usage */

import themed from './utils/themed';

// Each tint is made of N900 and an alpha channel
export var N0 = 'rgba(9, 30, 66, 0.02)';
export var N20A = 'rgba(9, 30, 66, 0.04)';
export var B100 = 'rgba(9, 30, 66, 0.04)';
export var N30A = 'rgba(9, 30, 66, 0.04)';
export var DN30 = '#8C9CB8';

export var background = themed({
  light: "var(--ds-surface, ".concat(N0, ")"),
  dark: "var(--ds-surface, ".concat(DN30, ")")
});


export var skeleton = function skeleton() {
  return "var(--ds-skeleton, ".concat(N20A, ")");
};