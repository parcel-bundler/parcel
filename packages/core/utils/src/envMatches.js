// @flow strict-local

import type {Environment} from '@parcel/types';
// $FlowFixMe
import browserslist from 'browserslist';
import semver from 'semver';

const BROWSERS = [
  'chrome',
  'and_chr',
  'edge',
  'firefox',
  'and_ff',
  'safari',
  'ios',
  'samsung',
  'opera',
  'ie',
  'op_mini',
  'blackberry',
  'op_mob',
  'ie_mob',
  'and_uc',
  'and_qq',
  'baidu',
  'kaios'
];

const ESMODULE_BROWSERS = {
  edge: '16',
  firefox: '60',
  chrome: '61',
  safari: '11',
  opera: '48',
  ios: '11',
  android: '76',
  and_chr: '76',
  and_ff: '68',
  samsung: '8.2'
};

type VersionMap = {
  [string]: string,
  ...
};

export function envMatches(env: Environment, minVersions: VersionMap) {
  // Determine if the environment matches some minimum version requirements.
  // For browsers, we run a browserslist query with and without the minimum
  // required browsers and compare the lists. For node, we just check semver.
  if (env.isBrowser() && env.engines.browsers != null) {
    let targetBrowsers = env.engines.browsers;
    let browsers =
      targetBrowsers != null && !Array.isArray(targetBrowsers)
        ? [targetBrowsers]
        : targetBrowsers;

    // If outputting esmodules, exclude browsers without support.
    if (env.outputFormat === 'esmodule') {
      browsers = [...browsers, ...getExcludedBrowsers(ESMODULE_BROWSERS)];
    }

    let matchedBrowsers = browserslist(browsers);
    let minBrowsers = getExcludedBrowsers(minVersions);
    let withoutMinBrowsers = browserslist([...browsers, ...minBrowsers]);
    return matchedBrowsers.length === withoutMinBrowsers.length;
  } else if (env.isNode() && env.engines.node != null && minVersions.node) {
    // $FlowFixMe
    return !semver.intersects(`< ${minVersions.node}`, env.engines.node);
  }

  return false;
}

function getExcludedBrowsers(minVersions: VersionMap) {
  let browsers = [];
  for (let browser of BROWSERS) {
    let version = minVersions[browser];
    if (version) {
      browsers.push(`not ${browser} < ${version}`);
    } else {
      browsers.push(`not ${browser} > 0`);
    }
  }

  return browsers;
}
