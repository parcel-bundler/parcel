// @flow
import type {
  ScopeHoistingPackager,
  OutputFormat,
} from './ScopeHoistingPackager';

export class AMDOutputFormat implements OutputFormat {
  packager: ScopeHoistingPackager;

  constructor(packager: ScopeHoistingPackager) {
    this.packager = packager;
  }

  getMainEntryAssetId(): ?string {
    const mainEntryAsset = this.packager.bundle.getMainEntry();

    // Sometimes there is no main asset, e.g. in the case of shared bundles.
    // In that case we don't need AMD wrapper as parcelRequire will be used for
    // loading shared bundle.
    if (!mainEntryAsset) {
      return;
    }

    const assetId = mainEntryAsset.id;
    // We don't need AMD wrapper for assets wrapped in parcelRequire.
    // For example, dynamically loaded chunk does not need to be an AMD.
    if (this.packager.wrappedAssets.has(assetId)) {
      return;
    }
    return assetId;
  }

  buildBundlePrelude(): [string, number] {
    const assetId = this.getMainEntryAssetId();
    if (!assetId) {
      return ['', 0];
    }

    const envSupportsArrowFunctions = this.packager.bundle.env.supports(
      'arrow-functions',
      true,
    );
    let prelude = '';
    let preludeLines = 0;

    let depArgs = [`$${assetId}$exports`];
    for (const [, specifiers] of this.packager.externals) {
      let arg = specifiers.get('*');
      if (!arg) {
        arg = `$${assetId}$arg${depArgs.length}`;
      }

      if (envSupportsArrowFunctions) {
        let destructuredItems = [];
        for (const [originalName, mangledName] of specifiers) {
          if (originalName !== '*') {
            destructuredItems.push(`${originalName}: ${mangledName}`);
          }
        }
        if (destructuredItems.length > 0) {
          prelude += `const {${destructuredItems.join(', ')}} = ${arg};\n`;
          preludeLines++;
        }
      } else {
        for (const [originalName, mangledName] of specifiers) {
          if (originalName !== '*') {
            prelude += `var ${mangledName} = ${arg}['${originalName}'];\n`;
            preludeLines++;
          }
        }
      }

      depArgs.push(arg);
    }
    depArgs = depArgs.join(', ');

    let deps = JSON.stringify(['exports', ...this.packager.externals.keys()]);
    prelude =
      (envSupportsArrowFunctions
        ? `define(${deps}, (${depArgs}) => {\n`
        : `define(${deps}, function (${depArgs}) {\n`) + prelude;
    preludeLines++;

    return [prelude, preludeLines];
  }

  buildBundlePostlude(): [string, number] {
    const assetId = this.getMainEntryAssetId();
    if (!assetId) {
      return ['', 0];
    }
    return ['});', 0];
  }
}
