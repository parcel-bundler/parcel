// @flow strict-local

import type SourceMap from '@parcel/source-map';
import type {
  Async,
  Blob,
  Bundle,
  BundleGraph,
  Dependency,
  NamedBundle,
} from '@parcel/types';

import {Readable} from 'stream';
import nullthrows from 'nullthrows';
import URL from 'url';
import {bufferStream, relativeBundlePath, urlJoin} from '../';

type ReplacementMap = Map<
  string /* dependency id */,
  {|from: string, to: string|},
>;

/*
 * Replaces references to dependency ids for URL dependencies with:
 *   - in the case of an unresolvable url dependency, the original moduleSpecifier.
 *     These are external requests that Parcel did not bundle.
 *   - in the case of a reference to another bundle, the relative url to that
 *     bundle from the current bundle.
 */
export function replaceURLReferences({
  bundle,
  bundleGraph,
  contents,
  map,
  relative = true,
}: {|
  bundle: NamedBundle,
  bundleGraph: BundleGraph<NamedBundle>,
  contents: string,
  relative?: boolean,
  map?: ?SourceMap,
|}): {|+contents: string, +map: ?SourceMap|} {
  let replacements = new Map();
  let urlDependencies = [];
  bundle.traverse(node => {
    if (node.type === 'dependency' && node.value.isURL) {
      urlDependencies.push(node.value);
    }
  });

  for (let dependency of urlDependencies) {
    if (!dependency.isURL) {
      continue;
    }

    let resolved = bundleGraph.getReferencedBundle(dependency, bundle);
    if (resolved == null) {
      replacements.set(dependency.id, {
        from: dependency.id,
        to: dependency.moduleSpecifier,
      });
      continue;
    }

    if (!resolved || resolved.isInline) {
      // If a bundle is inline, it should be replaced with inline contents,
      // not a URL.
      continue;
    }

    replacements.set(
      dependency.id,
      getURLReplacement({
        dependency,
        fromBundle: bundle,
        toBundle: resolved,
        relative,
      }),
    );
  }

  return performReplacement(replacements, contents, map);
}

/*
 * Replaces references to dependency ids for inline bundles with the packaged
 * contents of that bundle.
 */
export async function replaceInlineReferences({
  bundle,
  bundleGraph,
  contents,
  map,
  getInlineReplacement,
  getInlineBundleContents,
}: {|
  bundle: Bundle,
  bundleGraph: BundleGraph<NamedBundle>,
  contents: string,
  getInlineReplacement: (
    Dependency,
    ?'string',
    string,
  ) => {|from: string, to: string|},
  getInlineBundleContents: (
    Bundle,
    BundleGraph<NamedBundle>,
  ) => Async<{|contents: Blob|}>,
  map?: ?SourceMap,
|}): Promise<{|+contents: string, +map: ?SourceMap|}> {
  let replacements = new Map();

  let dependencies = [];
  bundle.traverse(node => {
    if (node.type === 'dependency') {
      dependencies.push(node.value);
    }
  });

  for (let dependency of dependencies) {
    let entryBundle = bundleGraph.getReferencedBundle(dependency, bundle);
    if (!entryBundle?.isInline) {
      continue;
    }

    let packagedBundle = await getInlineBundleContents(
      entryBundle,
      bundleGraph,
    );
    let packagedContents = (packagedBundle.contents instanceof Readable
      ? await bufferStream(packagedBundle.contents)
      : packagedBundle.contents
    ).toString();

    let inlineType = nullthrows(entryBundle.getEntryAssets()[0]).meta
      .inlineType;
    if (inlineType == null || inlineType === 'string') {
      replacements.set(
        dependency.id,
        getInlineReplacement(dependency, inlineType, packagedContents),
      );
    }
  }

  return performReplacement(replacements, contents, map);
}

export function getURLReplacement({
  dependency,
  fromBundle,
  toBundle,
  relative,
}: {|
  dependency: Dependency,
  fromBundle: NamedBundle,
  toBundle: NamedBundle,
  relative: boolean,
|}): {|from: string, to: string|} {
  let to;

  if (relative) {
    to = URL.format(
      URL.parse(
        relativeBundlePath(fromBundle, toBundle, {
          leadingDotSlash: false,
        }),
      ),
    );
  } else {
    to = urlJoin(
      toBundle.target.publicUrl,
      URL.format(URL.parse(nullthrows(toBundle.name))),
    );
  }

  return {
    from: dependency.id,
    to,
  };
}

function performReplacement(
  replacements: ReplacementMap,
  contents: string,
  map?: ?SourceMap,
): {|+contents: string, +map: ?SourceMap|} {
  let finalContents = contents;
  for (let {from, to} of replacements.values()) {
    // Perform replacement
    finalContents = finalContents.split(from).join(to);
  }

  return {
    contents: finalContents,
    // TODO: Update sourcemap with adjusted contents
    map,
  };
}
