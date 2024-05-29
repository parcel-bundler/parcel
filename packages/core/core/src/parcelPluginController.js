// @flow
import * as napi from '@parcel/rust';
import type {Resolver} from '@parcel/types';
import type {ParcelOptions, ParcelPluginNode} from './types';
import type ParcelConfig from './ParcelConfig';
import {ResolverRunner} from './requests/PathRequest';
import {fromProjectPath, toProjectPathUnsafe} from './projectPath';
import loadPlugin from './loadParcelPlugin.js';

type ControllerWorkerRequest = {|Ping: {||}|};

type ControllerWorkerResponse = {|Ping: {||}|};

export async function parcelPluginController(options: ParcelOptions) {
  napi.parcelControllerMain(
    async (
      _,
      event: ControllerWorkerRequest,
    ): Promise<ControllerWorkerResponse> => {
      console.log('hello', event);

      return {Ping: {}};
    },
  );
}

async function loadResolver(
  packageName: string,
  resolveFrom: string,
  options: ParcelOptions,
): Promise<Resolver<mixed>> {
  let node: ParcelPluginNode = {
    packageName: '@parcel/resolver-default',
    resolveFrom: toProjectPathUnsafe(resolveFrom),
    // keyPath
  };

  let plugin = await loadPlugin<Resolver<mixed>>(
    node.packageName,
    fromProjectPath(options.projectRoot, node.resolveFrom),
    node.keyPath,
    options,
  );

  return plugin.plugin;
}
