// @flow strict-local
import ansiHTML from 'ansi-html';
// flowlint-next-line untyped-import:off
import {escapeHTML} from './escape-html';

export function ansiHtml(ansi: string): string {
  return ansiHTML(escapeHTML(ansi));
}
