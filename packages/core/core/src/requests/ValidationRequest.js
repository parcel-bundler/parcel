// @flow strict-local
import type {Async} from '@atlaspack/types';
import type {SharedReference} from '@atlaspack/workers';
import type {StaticRunOpts} from '../RequestTracker';
import type {AssetGroup} from '../types';
import type {ConfigAndCachePath} from './AtlaspackConfigRequest';

import nullthrows from 'nullthrows';
import AtlaspackConfig from '../AtlaspackConfig';
import {report} from '../ReporterRunner';
import Validation from '../Validation';
import createAtlaspackConfigRequest from './AtlaspackConfigRequest';
import {requestTypes} from '../RequestTracker';

type ValidationRequest = {|
  id: string,
  +type: typeof requestTypes.validation_request,
  run: (RunOpts<void>) => Async<void>,
  input: ValidationRequestInput,
|};

type RunOpts<TResult> = {|
  input: ValidationRequestInput,
  ...StaticRunOpts<TResult>,
|};

type ValidationRequestInput = {|
  assetRequests: Array<AssetGroup>,
  optionsRef: SharedReference,
|};

export default function createValidationRequest(
  input: ValidationRequestInput,
): ValidationRequest {
  return {
    id: 'validation',
    type: requestTypes.validation_request,
    run: async ({input: {assetRequests, optionsRef}, api, options, farm}) => {
      let {config: processedConfig, cachePath} = nullthrows(
        await api.runRequest<null, ConfigAndCachePath>(
          createAtlaspackConfigRequest(),
        ),
      );

      let config = new AtlaspackConfig(processedConfig, options);
      let trackedRequestsDesc = assetRequests.filter(request => {
        return config.getValidatorNames(request.filePath).length > 0;
      });

      // Schedule validations on workers for all plugins that implement the one-asset-at-a-time "validate" method.
      let promises = trackedRequestsDesc.map(
        async request =>
          ((await farm.createHandle('runValidate'))({
            requests: [request],
            optionsRef: optionsRef,
            configCachePath: cachePath,
          }): void),
      );

      // Skip sending validation requests if no validators were configured
      if (trackedRequestsDesc.length === 0) {
        return;
      }

      // Schedule validations on the main thread for all validation plugins that implement "validateAll".
      promises.push(
        new Validation({
          requests: trackedRequestsDesc,
          options,
          config,
          report,
          dedicatedThread: true,
        }).run(),
      );
      await Promise.all(promises);
    },
    input,
  };
}
