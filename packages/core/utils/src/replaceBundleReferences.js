// @flow strict-local

import type SourceMap from '@parcel/source-map';
import type {Async, Blob, Bundle, BundleGraph} from '@parcel/types';

import {Readable} from 'stream';
import {bufferStream, urlJoin} from '../';

import nullthrows from 'nullthrows';

/*
 * Replaces references to dependency ids with either:
 *   - in the case of an inline bundle, the packaged contents of that bundle
 *   - in the case of another bundle reference, the bundle's url from the publicUrl root
 *   - in the case of a url dependency that Parcel did not handle,
 *     the original moduleSpecifier. These are external requests.
 */
export default async function replaceBundleReferences({
  bundle,
  bundleGraph,
  contents,
  map,
  formatInline = str => str,
  getInlineBundleContents
}: {|
  bundle: Bundle,
  bundleGraph: BundleGraph,
  contents: string,
  formatInline?: string => string,
  getInlineBundleContents: (
    Bundle,
    BundleGraph
  ) => Async<{|contents: Blob, map: ?(Readable | string)|}>,
  map?: ?SourceMap
|}) {
  let replacements = new Map();

  for (let {
    dependency,
    bundleGroup
  } of bundleGraph.getBundleGroupsReferencedByBundle(bundle)) {
    let [entryBundle] = bundleGraph.getBundlesInBundleGroup(bundleGroup);
    if (entryBundle.isInline) {
      // inline bundles
      let packagedBundle = await getInlineBundleContents(
        entryBundle,
        bundleGraph
      );
      let packagedContents = (packagedBundle.contents instanceof Readable
        ? await bufferStream(packagedBundle.contents)
        : packagedBundle.contents
      ).toString();
      replacements.set(dependency.id, formatInline(packagedContents));
    } else {
      // url references
      replacements.set(
        dependency.id,
        urlJoin(
          entryBundle.target.publicUrl ?? '/',
          nullthrows(entryBundle.name)
        )
      );
    }
  }

  // external url references
  bundle.traverse(node => {
    if (node.type !== 'dependency') {
      return;
    }

    let dependency = node.value;
    if (dependency.isURL && !replacements.has(dependency.id)) {
      replacements.set(dependency.id, dependency.moduleSpecifier);
    }
  });

  let finalContents = contents;
  for (let [depId, replacement] of replacements) {
    finalContents = finalContents.replace(new RegExp(depId, 'g'), replacement);
  }

  return {
    contents: finalContents,
    // TODO: Update sourcemap with adjusted contents
    map
  };
}
