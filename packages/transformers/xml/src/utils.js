// @flow
import type {MutableAsset} from '@parcel/types';

export function urlHandler(element: Element, asset: MutableAsset) {
  element.textContent = asset.addURLDependency(element.textContent.trim(), {
    needsStableName: true,
  });
}
