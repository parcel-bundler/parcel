import _extends from "@babel/runtime/helpers/esm/extends";
import _objectWithoutProperties from "@babel/runtime/helpers/esm/objectWithoutProperties";
import { createElement } from "@wordpress/element";

/**
 * External dependencies
 */
import { unstable_CompositeItem as CompositeItem } from 'reakit/Composite';
/**
 * Internal dependencies
 */

import Tooltip from '../tooltip';
import VisuallyHidden from '../visually-hidden';
/**
 * Internal dependencies
 */

import { ALIGNMENT_LABEL } from './utils';
import { Cell as CellView, Point } from './styles/alignment-matrix-control-styles';
export default function Cell(_ref) {
  var _ref$isActive = _ref.isActive,
      isActive = _ref$isActive === void 0 ? false : _ref$isActive,
      value = _ref.value,
      props = _objectWithoutProperties(_ref, ["isActive", "value"]);

  var tooltipText = ALIGNMENT_LABEL[value];
  return createElement(Tooltip, {
    text: tooltipText
  }, createElement(CompositeItem, _extends({
    as: CellView,
    role: "gridcell"
  }, props), createElement(VisuallyHidden, null, value), createElement(Point, {
    isActive: isActive,
    role: "presentation"
  })));
}
//# sourceMappingURL=cell.js.map
