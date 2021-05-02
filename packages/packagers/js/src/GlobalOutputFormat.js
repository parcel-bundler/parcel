// @flow
import type {
  ScopeHoistingPackager,
  OutputFormat,
} from './ScopeHoistingPackager';

export class GlobalOutputFormat implements OutputFormat {
  packager: ScopeHoistingPackager;

  constructor(packager: ScopeHoistingPackager) {
    this.packager = packager;
  }

  buildBundlePrelude(): [string, number] {
    return ['(function () {\n', 1];
  }

  buildBundlePostlude(): string {
    return '})();';
  }
}
