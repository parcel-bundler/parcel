// @flow
import type {SWCPackager, OutputFormat} from './SWCPackager';

export class GlobalOutputFormat implements OutputFormat {
  packager: SWCPackager;

  constructor(packager: SWCPackager) {
    this.packager = packager;
  }

  buildBundlePrelude(): [string, number] {
    return ['(function () {\n', 1];
  }

  buildBundlePostlude(): string {
    return '})();';
  }
}
