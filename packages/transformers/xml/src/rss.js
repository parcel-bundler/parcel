// @flow
import type {MutableAsset, TransformerResult} from '@atlaspack/types';
import {urlHandler} from './utils';

// Handlers for elements defined by the RSS spec.
// See https://validator.w3.org/feed/docs/rss2.html

export const link = urlHandler;
export const url = urlHandler;
export const comments = urlHandler;

export function enclosure(element: Element, asset: MutableAsset) {
  let url = element.getAttribute('url');
  if (url) {
    url = asset.addURLDependency(url, {});
    element.setAttribute('url', url);
  }
}

export function description(
  element: Element,
  asset: MutableAsset,
  parts: Array<TransformerResult>,
) {
  let atlaspackKey = `${asset.id}:${parts.length}`;

  asset.addDependency({
    specifier: atlaspackKey,
    specifierType: 'esm',
    bundleBehavior: 'inline',
  });

  parts.push({
    type: 'html',
    content: element.textContent,
    uniqueKey: atlaspackKey,
    bundleBehavior: 'inline',
  });

  let child;
  while ((child = element.firstChild)) {
    element.removeChild(child);
  }

  let el = element.ownerDocument.createElementNS(
    'https://parceljs.org',
    'inline',
  );
  el.setAttribute('key', atlaspackKey);
  element.appendChild(el);
}
