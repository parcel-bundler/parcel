// @flow
import type { Writable } from 'stream';

module.exports = function(stream: Writable): string {
  return 'hello world'
}
