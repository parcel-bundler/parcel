// @flow strict-local
import type {PackagedBundle} from '@parcel/types';
import type {SharedReference} from '@parcel/workers';
import type {StaticRunOpts} from '../RequestTracker';
import type {AssetGroup} from '../types';
import type {ConfigAndCachePath} from './ParcelConfigRequest';
import type BundleGraph from '../public/BundleGraph';
import type {ValidationMap} from '../Validation';

import nullthrows from 'nullthrows';
import ParcelConfig from '../ParcelConfig';
import {report} from '../ReporterRunner';
import Validation from '../Validation';
import createParcelConfigRequest from './ParcelConfigRequest';

type ValidationRequest = {|
  id: string,
  +type: 'validation_request',
  run: RunOpts => Promise<ValidationMap>,
  input: ValidationRequestInput,
|};

type RunOpts = {|
  input: ValidationRequestInput,
  ...StaticRunOpts,
|};

type ValidationRequestInput = {|
  changedAssetGroups: Array<AssetGroup>,
  optionsRef: SharedReference,
  bundleGraph: BundleGraph<PackagedBundle>,
|};

export default function createValidationRequest(
  input: ValidationRequestInput,
): ValidationRequest {
  return {
    id: 'validation',
    type: 'validation_request',
    run: async ({
      input: {changedAssetGroups, optionsRef, bundleGraph},
      api,
      options,
      farm,
    }) => {
      let {config: processedConfig, cachePath} = nullthrows(
        await api.runRequest<null, ConfigAndCachePath>(
          createParcelConfigRequest(),
        ),
      );

      let config = new ParcelConfig(processedConfig, options);
      let [assetValidations, {validateAll, validateBundles}] =
        await Promise.all([
          // Schedule validations on workers for all plugins that implement the one-asset-at-a-time "validate" method.
          Promise.all(
            changedAssetGroups.map(async assetGroup => [
              assetGroup.filePath,
              await farm.createHandle('runValidate')({
                assetGroup,
                optionsRef: optionsRef,
                configCachePath: cachePath,
              }),
            ]),
          ),
          // Schedule validations on the main thread for all validation plugins that implement "validateAll".
          new Validation({
            options,
            config,
            report,
          }).run(changedAssetGroups, bundleGraph),
        ]);

      let result = {
        validate: new Map(assetValidations.filter(([, val]) => val != null)),
        validateAll,
        validateBundles,
      };
      api.storeResult(result);
      return result;
    },
    input,
  };
}
