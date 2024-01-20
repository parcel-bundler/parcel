// @flow
import type {MutableAsset, TransformerResult} from '@parcel/types';
import {XMLSerializer} from '@xmldom/xmldom';
import {urlHandler} from './utils';

// Handlers for elements defined by the Atom spec.
// See https://datatracker.ietf.org/doc/html/rfc4287

export function link(element: Element, asset: MutableAsset) {
  let href = element.getAttribute('href');
  if (href) {
    href = asset.addURLDependency(href, {
      needsStableName: true,
    });

    element.setAttribute('href', href);
  }
}

export const icon = urlHandler;
export const logo = urlHandler;

export function content(
  element: Element,
  asset: MutableAsset,
  parts: Array<TransformerResult>,
) {
  let type = element.getAttribute('type');
  let contents;
  switch (type) {
    case 'html':
      contents = element.textContent;
      element.textContent = '';
      break;
    case 'xhtml': {
      let fragment = element.ownerDocument.createDocumentFragment();
      let child;
      while ((child = element.firstChild)) {
        element.removeChild(child);
        fragment.appendChild(child.cloneNode(true));
      }
      contents = new XMLSerializer().serializeToString(fragment);
      break;
    }
    default:
      return;
  }

  if (contents) {
    let parcelKey = `${asset.id}:${parts.length}`;
    let el = element.ownerDocument.createElementNS(
      'https://parceljs.org',
      'inline',
    );
    el.setAttribute('key', parcelKey);
    el.setAttribute('type', type);
    element.appendChild(el);

    asset.addDependency({
      specifier: parcelKey,
      specifierType: 'esm',
      bundleBehavior: 'inline',
    });

    parts.push({
      type,
      content: contents,
      uniqueKey: parcelKey,
      bundleBehavior: 'inline',
    });
  }
}
