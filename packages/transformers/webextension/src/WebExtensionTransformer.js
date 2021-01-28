// @flow

import type {MutableAsset} from '@parcel/types';
import {Transformer} from '@parcel/plugin';
import {join, extname, dirname, relative} from 'path';
import jsm from 'json-source-map';
import parseCSP from 'content-security-policy-parser';
import {validateSchema} from '@parcel/utils';
import ThrowableDiagnostic, {getJSONSourceLocation} from '@parcel/diagnostic';
import {glob} from '@parcel/utils';
import WebExtensionSchema from './schema';

const DEP_LOCS = [
  ['icons'],
  ['browser_action', 'default_icon'],
  ['browser_action', 'default_popup'],
  ['page_action', 'default_icon'],
  ['page_action', 'default_popup'],
  ['background', 'scripts'],
  ['chrome_url_overrides'],
  ['devtools_page'],
  ['options_ui', 'page'],
  ['sidebar_action', 'default_icon'],
  ['sidebar_action', 'default_panel'],
  ['storage', 'managed_schema'],
  ['theme', 'images', 'theme_frame'],
  ['theme', 'images', 'additional_backgrounds'],
  ['user_scripts', 'api_script'],
];

async function collectDependencies(
  asset: MutableAsset,
  program: any,
  ptrs: {[key: string]: any, ...},
  hot: boolean,
) {
  // isEntry used whenever strictly necessary to preserve filename
  // also for globs because it's wasteful to write out every file name
  const fs = asset.fs;
  const filePath = asset.filePath;
  if (program.default_locale) {
    const locales = join(dirname(filePath), '_locales');
    let err = !(await fs.exists(locales))
      ? 'key'
      : !(await fs.exists(join(locales, program.default_locale)))
      ? 'value'
      : null;
    if (err) {
      throw new ThrowableDiagnostic({
        diagnostic: [
          {
            message: 'Invalid Web Extension manifest',
            origin: '@parcel/transformer-webextension',
            filePath,
            codeFrame: {
              codeHighlights: [
                {
                  ...getJSONSourceLocation(ptrs['/default_locale'], err),
                  message: `Localization directory${
                    err == 'value' ? ' for ' + program.default_locale : ''
                  } does not exist: ${relative(
                    dirname(filePath),
                    join(locales, program.default_locale),
                  )}`,
                },
              ],
            },
          },
        ],
      });
    }
    for (const locale of await fs.readdir(locales)) {
      asset.addURLDependency(`_locales/${locale}/messages.json`, {
        isEntry: true,
        pipeline: 'url',
      });
    }
  }
  let needRuntimeBG = false;
  if (program.content_scripts) {
    for (let i = 0; i < program.content_scripts.length; ++i) {
      const sc = program.content_scripts[i];
      for (const k of ['css', 'js']) {
        const assets = sc[k] || [];
        for (let j = 0; j < assets.length; ++j) {
          assets[j] = asset.addURLDependency(assets[j], {
            isEntry: true,
            loc: {
              filePath,
              ...getJSONSourceLocation(
                ptrs[`/content_scripts/${i}/${k}/${j}`],
                'value',
              ),
            },
          });
        }
      }
      if (hot && sc.js && sc.js.length) {
        needRuntimeBG = true;
        sc.js.push(
          asset.addURLDependency('./runtime/autoreload.js', {
            resolveFrom: __filename,
          }),
        );
      }
    }
  }
  if (program.dictionaries) {
    for (const dict in program.dictionaries) {
      const sourceLoc = getJSONSourceLocation(
        ptrs[`/dictionaries/${dict}`],
        'value',
      );
      const loc = {
        filePath,
        ...sourceLoc,
      };
      const dictFile = program.dictionaries[dict];
      if (extname(dictFile) != '.dic') {
        throw new ThrowableDiagnostic({
          diagnostic: [
            {
              message: 'Invalid Web Extension manifest',
              origin: '@parcel/transformer-webextension',
              filePath,
              codeFrame: {
                codeHighlights: [
                  {
                    ...sourceLoc,
                    message: 'Dictionaries must be .dic files',
                  },
                ],
              },
            },
          ],
        });
      }
      program.dictionaries[dict] = asset.addURLDependency(dictFile, {
        isEntry: true,
        loc,
      });
      asset.addURLDependency(dictFile.slice(0, -4) + '.aff', {
        isEntry: true,
        loc,
      });
    }
  }
  if (program.browser_action?.theme_icons) {
    for (let i = 0; i < program.browser_action.theme_icons.length; ++i) {
      const themeIcon = program.browser_action.theme_icons[i];
      for (const k of ['light', 'dark']) {
        const loc = getJSONSourceLocation(
          ptrs[`/browser_action/theme_icons/${i}/${k}`],
          'value',
        );
        themeIcon[k] = asset.addURLDependency(themeIcon[k], {
          isEntry: true,
          loc: {
            ...loc,
            filePath,
          },
        });
      }
    }
  }
  if (program.web_accessible_resources) {
    for (let i = 0; i < program.web_accessible_resources.length; ++i) {
      // TODO: this doesn't support Parcel resolution
      const globQuery = join(
        dirname(filePath),
        program.web_accessible_resources[i],
      );
      for (const fp of await glob(globQuery, fs, {})) {
        asset.addURLDependency(relative(dirname(filePath), fp), {
          isEntry: true,
          loc: {
            filePath,
            ...getJSONSourceLocation(ptrs[`/web_accessible_resources/${i}`]),
          },
        });
      }
    }
  }
  for (const loc of DEP_LOCS) {
    const location = '/' + loc.join('/');
    if (!ptrs[location]) continue;
    let parent: any = program;
    for (let i = 0; i < loc.length - 1; ++i) {
      parent = parent[loc[i]];
    }
    const lastLoc = loc[loc.length - 1];
    const obj = parent[lastLoc];
    if (typeof obj == 'string')
      parent[lastLoc] = asset.addURLDependency(obj, {
        isEntry: true,
        loc: {
          filePath,
          ...getJSONSourceLocation(ptrs[location], 'value'),
        },
        pipeline: extname(obj) == '.json' ? 'url' : undefined,
      });
    else {
      for (const k of Object.keys(obj)) {
        obj[k] = asset.addURLDependency(obj[k], {
          isEntry: true,
          loc: {
            filePath,
            ...getJSONSourceLocation(ptrs[location + '/' + k], 'value'),
          },
          pipeline: extname(obj[k]) == '.json' ? 'url' : undefined,
        });
      }
    }
  }
  if (needRuntimeBG) {
    if (!program.background) {
      program.background = {};
    }
    if (!program.background.scripts) {
      program.background.scripts = [];
    }
    program.background.scripts.push(
      asset.addURLDependency('./runtime/autoreload-bg.js', {
        resolveFrom: __filename,
      }),
    );
  }
}

function cspPatchHMR(policy: ?string) {
  if (policy) {
    const csp = parseCSP(policy);
    policy = '';
    if (!csp['script-src']) {
      csp['script-src'] = ["'self' 'unsafe-eval' blob: filesystem:"];
    }
    if (!csp['script-src'].includes("'unsafe-eval'")) {
      csp['script-src'].push("'unsafe-eval'");
    }
    for (const k in csp) {
      policy += `${k} ${csp[k].join(' ')};`;
    }
    return policy;
  } else {
    return (
      "script-src 'self' 'unsafe-eval' blob: filesystem:;" +
      "object-src 'self' blob: filesystem:;"
    );
  }
}

export default (new Transformer({
  async transform({asset, options}) {
    const code = await asset.getCode();
    const parsed = jsm.parse(code);
    const data: any = parsed.data;
    validateSchema.diagnostic(
      WebExtensionSchema,
      {
        data: data,
        source: code,
        filePath: asset.filePath,
      },
      '@parcel/transformer-webextension',
      'Invalid Web Extension manifest',
    );
    await collectDependencies(
      asset,
      data,
      parsed.pointers,
      Boolean(options.hmrOptions),
    );
    if (options.hmrOptions) {
      // To enable HMR, we must override the CSP to allow 'unsafe-eval'
      data.content_security_policy = cspPatchHMR(data.content_security_policy);
    }
    asset.meta.handled = true;
    asset.setCode(JSON.stringify(data));
    return [asset];
  },
}): Transformer);
