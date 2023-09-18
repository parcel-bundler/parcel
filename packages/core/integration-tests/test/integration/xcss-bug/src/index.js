// import _extends from "@babel/runtime/helpers/extends";
// import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
// import Popup from '@atlaskit/popup';
import { Inline, xcss } from '@atlaskit/primitives';
import { media, UNSAFE_useMediaQuery as useMediaQuery } from '@atlaskit/primitives/responsive';
// import { OverflowProvider } from '../../controllers/overflow';
// import { PrimaryDropdownButton } from '../PrimaryDropdownButton';
const sharedContainerStyles = xcss({
  height: '100%',
  alignItems: 'stretch',
  paddingInlineEnd: 'space.050',
  gap: 'space.100'
});
const smallContainerStyles = xcss({
  [media.above.sm]: {
    display: 'none'
  }
});
const mediumContainerStyles = xcss({
  display: 'none',
  [media.above.sm]: {
    display: 'flex'
  },
  [media.above.lg]: {
    display: 'none'
  }
});
const largeContainerStyles = xcss({
  display: 'none',
  [media.above.lg]: {
    display: 'flex'
  }
});
// const MoreItemsPopup = ({
//   moreLabel,
//   testId,
//   items
// }) => {
//   const [isMoreOpen, setIsMoreOpen] = useState(false);
//   const onMoreClose = useCallback(() => setIsMoreOpen(false), []);
//   const onMoreClick = useCallback(() => setIsMoreOpen(current => !current), []);
//   const openOverflowMenu = useCallback(() => setIsMoreOpen(true), []);
//   const trigger = useCallback(triggerProps => /*#__PURE__*/React.createElement(PrimaryDropdownButton, _extends({
//     onClick: onMoreClick,
//     isSelected: isMoreOpen,
//     testId: testId ? `${testId}-overflow-menu-trigger` : 'overflow-menu-trigger'
//   }, triggerProps), moreLabel), [moreLabel, onMoreClick, isMoreOpen, testId]);
//   const content = useCallback(() => /*#__PURE__*/React.createElement(OverflowProvider, {
//     isVisible: false,
//     openOverflowMenu: openOverflowMenu,
//     closeOverflowMenu: onMoreClose
//   }, items), [items, openOverflowMenu, onMoreClose]);
//   return /*#__PURE__*/React.createElement(Popup, {
//     placement: "bottom-start",
//     isOpen: isMoreOpen,
//     onClose: onMoreClose,
//     trigger: trigger,
//     content: content,
//     testId: testId ? `${testId}-overflow-menu-popup` : 'overflow-menu-popup'
//   });
// };

export const PrimaryItemsContainer = [smallContainerStyles, largeContainerStyles];
// Internal only
// eslint-disable-next-line @repo/internal/react/require-jsdoc
// export const PrimaryItemsContainer = /*#__PURE__*/memo(({
//   moreLabel,
//   items,
//   create: Create,
//   theme,
//   testId
// }) => {
//   // We render a CSS media query based nav at first to handle SSR, then use
//   // our useMediaQuery hook once we are hydrated so there is only one set of nav items
//   const [isClient, setIsClient] = useState(false);
//   useEffect(() => {
//     setIsClient(true);
//   }, []);

//   // Setting up our media queries to use once app is hydrated
//   const mqSm = useMediaQuery('above.sm', event => setIsAboveSm(event.matches));
//   const [isAboveSm, setIsAboveSm] = useState(mqSm === null || mqSm === void 0 ? void 0 : mqSm.matches);
//   const mqLg = useMediaQuery('above.lg', event => setIsAboveLg(event.matches));
//   const [isAboveLg, setIsAboveLg] = useState(mqLg === null || mqLg === void 0 ? void 0 : mqLg.matches);

//   // Filter out any falsy items passed in
//   const filteredItems = useMemo(() => React.Children.toArray(items).filter(item => !!item), [items]);
//   // NOTE: we could make these max items configurable in the future. For now
//   // we are using sensible defaults. Anything over the max gets put in the
//   // overflow menu for that screen size.
//   // While it may be tempting to use more than 3 items for the medium nav when
//   // you see the available space, you need to consider internationalistion.
//   // 3 is the safe, defensive choice across many languages and scripts.
//   const smallMaxItems = 0;
//   const mediumMaxItems = 3;
//   const largeMaxItems = 8;

//   // We re-use this in both the CSS media query nav that loads in for SSR,
//   // and the JS/hook media query nav that is used once hydrated
//   const navItems = useMemo(() => {
//     return {
//       small: {
//         navBarItems: [],
//         overflowItems: filteredItems
//       },
//       medium: {
//         navBarItems: filteredItems.slice(0, mediumMaxItems),
//         overflowItems: filteredItems.slice(mediumMaxItems, filteredItems.length)
//       },
//       large: {
//         navBarItems: filteredItems.slice(0, largeMaxItems),
//         overflowItems: filteredItems.slice(largeMaxItems, filteredItems.length)
//       }
//     };
//   }, [filteredItems]);
//   const hydratedNavItems = useMemo(() => {
//     if (isAboveLg) {
//       return navItems.large;
//     }
//     if (isAboveSm && !isAboveLg) {
//       return navItems.medium;
//     }
//     return navItems.small;
//   }, [isAboveLg, isAboveSm, navItems.large, navItems.medium, navItems.small]);
//   return /*#__PURE__*/React.createElement(React.Fragment, null, isClient ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Inline, {
//     testId: testId && `${testId}-primary-actions`,
//     xcss: sharedContainerStyles
//   }, hydratedNavItems.navBarItems, hydratedNavItems.overflowItems.length > 0 && /*#__PURE__*/React.createElement(MoreItemsPopup, {
//     moreLabel: moreLabel,
//     items: hydratedNavItems.overflowItems,
//     testId: testId
//   }))) : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Inline, {
//     xcss: [sharedContainerStyles, smallContainerStyles]
//   }, filteredItems.length > smallMaxItems &&
//   /*#__PURE__*/
//   // We don't need to pass items into popup, it won't be interactive (SSR only)
//   React.createElement(MoreItemsPopup, {
//     moreLabel: moreLabel,
//     testId: testId
//   })), /*#__PURE__*/React.createElement(Inline, {
//     xcss: [sharedContainerStyles, mediumContainerStyles]
//   }, navItems.medium.navBarItems, navItems.medium.overflowItems.length > 0 && /*#__PURE__*/React.createElement(MoreItemsPopup, {
//     moreLabel: moreLabel,
//     testId: testId
//   })), /*#__PURE__*/React.createElement(Inline, {
//     xcss: [sharedContainerStyles, largeContainerStyles]
//   }, navItems.large.navBarItems, navItems.large.overflowItems.length > 0 && /*#__PURE__*/React.createElement(MoreItemsPopup, {
//     moreLabel: moreLabel,
//     testId: testId
//   }))), Create && /*#__PURE__*/React.createElement(Create, null));
// });