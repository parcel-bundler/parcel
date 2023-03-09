// @flow strict-local
/* eslint-disable monorepo/no-internal-import */

import type {ContentGraph} from '@parcel/graph';
import type {BundleGraphNode} from '@parcel/core/src/types';
import type {BundleGraphEdgeType} from '@parcel/core/src/BundleGraph';

import {GraphExplorer} from 'parcel-graph-explorer';
import {Reporter} from '@parcel/plugin';
import invariant from 'assert';
import nullthrows from 'nullthrows';

type InstanceId = string;

const graphs: Map<
  InstanceId,
  ContentGraph<BundleGraphNode, BundleGraphEdgeType>,
> = new Map();

export function debug(
  instanceId: InstanceId,
  graph: ContentGraph<BundleGraphNode, BundleGraphEdgeType>,
) {
  graphs.set(instanceId, graph);
}

const servers: Map<InstanceId, GraphExplorer> = new Map();

export default (new Reporter({
  async report({event, logger, options}) {
    switch (event.type) {
      case 'watchStart': {
        invariant(!servers.has(options.instanceId));

        let graph = nullthrows(graphs.get(options.instanceId));
        let explorer = new GraphExplorer(graph, logger, {
          verbose: options.logLevel === 'verbose',
        });

        servers.set(options.instanceId, explorer);

        await explorer.start();

        break;
      }

      case 'watchEnd': {
        await nullthrows(servers.get(options.instanceId)).dispose();
        break;
      }
    }
  },
}): Reporter);
