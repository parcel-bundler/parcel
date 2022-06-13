// @flow
import type {MutableAsset, HMROptions} from '@parcel/types';

import {Transformer} from '@parcel/plugin';
import path from 'path';
import {parse} from '@mischnic/json-sourcemap';
import parseCSP from 'content-security-policy-parser';
import {validateSchema} from '@parcel/utils';
import ThrowableDiagnostic, {
  getJSONSourceLocation,
  md,
} from '@parcel/diagnostic';
import {glob} from '@parcel/utils';
import {MV3Schema, MV2Schema, VersionSchema} from './schema';

const DEP_LOCS = [
  ['icons'],
  ['browser_action', 'default_icon'],
  ['browser_action', 'default_popup'],
  ['page_action', 'default_icon'],
  ['page_action', 'default_popup'],
  ['action', 'default_icon'],
  ['action', 'default_popup'],
  ['background', 'scripts'],
  ['chrome_url_overrides'],
  ['devtools_page'],
  ['options_ui', 'page'],
  ['sandbox', 'pages'],
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
  hmrOptions: ?HMROptions,
) {
  const hot = Boolean(hmrOptions);
  const fs = asset.fs;
  const filePath = asset.filePath;
  const assetDir = path.dirname(filePath);
  const isMV2 = program.manifest_version == 2;
  delete program.$schema;
  if (program.default_locale) {
    const locales = path.join(assetDir, '_locales');
    let err = !(await fs.exists(locales))
      ? 'key'
      : !(await fs.exists(
          path.join(locales, program.default_locale, 'messages.json'),
        ))
      ? 'value'
      : null;
    if (err) {
      throw new ThrowableDiagnostic({
        diagnostic: [
          {
            message: 'Invalid Web Extension manifest',
            origin: '@parcel/transformer-webextension',
            codeFrames: [
              {
                filePath,
                codeHighlights: [
                  {
                    ...getJSONSourceLocation(ptrs['/default_locale'], err),
                    message: md`Localization ${
                      err == 'value'
                        ? 'file for ' + program.default_locale
                        : 'directory'
                    } does not exist: ${path.relative(
                      assetDir,
                      path.join(locales, program.default_locale),
                    )}`,
                  },
                ],
              },
            ],
          },
        ],
      });
    }
    for (const locale of await fs.readdir(locales)) {
      if (await fs.exists(path.join(locales, locale, 'messages.json'))) {
        asset.addURLDependency(`_locales/${locale}/messages.json`, {
          needsStableName: true,
          pipeline: 'raw',
        });
      }
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
            bundleBehavior: 'isolated',
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
      if (path.extname(dictFile) != '.dic') {
        throw new ThrowableDiagnostic({
          diagnostic: [
            {
              message: 'Invalid Web Extension manifest',
              origin: '@parcel/transformer-webextension',
              codeFrames: [
                {
                  filePath,
                  codeHighlights: [
                    {
                      ...sourceLoc,
                      message: 'Dictionaries must be .dic files',
                    },
                  ],
                },
              ],
            },
          ],
        });
      }
      program.dictionaries[dict] = asset.addURLDependency(dictFile, {
        needsStableName: true,
        loc,
      });
      asset.addURLDependency(dictFile.slice(0, -4) + '.aff', {
        needsStableName: true,
        loc,
      });
    }
  }
  const browserActionName = isMV2 ? 'browser_action' : 'action';
  if (program[browserActionName]?.theme_icons) {
    for (let i = 0; i < program[browserActionName].theme_icons.length; ++i) {
      const themeIcon = program[browserActionName].theme_icons[i];
      for (const k of ['light', 'dark']) {
        const loc = getJSONSourceLocation(
          ptrs[`/${browserActionName}/theme_icons/${i}/${k}`],
          'value',
        );
        themeIcon[k] = asset.addURLDependency(themeIcon[k], {
          loc: {
            ...loc,
            filePath,
          },
        });
      }
    }
  }
  if (program.web_accessible_resources) {
    let war = [];
    for (let i = 0; i < program.web_accessible_resources.length; ++i) {
      // TODO: this doesn't support Parcel resolution
      const currentEntry = program.web_accessible_resources[i];
      const files = isMV2 ? [currentEntry] : currentEntry.resources;
      let currentFiles = [];
      for (let j = 0; j < files.length; ++j) {
        const globFiles = (
          await glob(path.join(assetDir, files[j]), fs, {})
        ).map(fp =>
          asset.addURLDependency(path.relative(assetDir, fp), {
            bundleBehavior: 'isolated',
            needsStableName: true,
            loc: {
              filePath,
              ...getJSONSourceLocation(
                ptrs[
                  `/web_accessible_resources/${i}${
                    isMV2 ? '' : `/resources/${j}`
                  }`
                ],
              ),
            },
          }),
        );
        currentFiles = currentFiles.concat(globFiles);
      }
      if (isMV2) {
        war = war.concat(currentFiles);
      } else {
        currentEntry.resources = currentFiles;
        war.push(currentEntry);
      }
    }
    program.web_accessible_resources = war;
  }
  if (program.declarative_net_request) {
    const rrs: {|path: string, id: string, enabled: boolean|}[] =
      program.declarative_net_request?.rule_resources ?? [];
    rrs.forEach((resources, i) => {
      resources.path = asset.addURLDependency(resources.path, {
        pipeline: 'raw',
        loc: {
          filePath,
          ...getJSONSourceLocation(
            ptrs[`/declarative_net_request/rule_resources/${i}/path`],
            'value',
          ),
        },
      });
    });
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
        bundleBehavior: 'isolated',
        loc: {
          filePath,
          ...getJSONSourceLocation(ptrs[location], 'value'),
        },
        pipeline: path.extname(obj) == '.json' ? 'raw' : undefined,
      });
    else {
      for (const k of Object.keys(obj)) {
        obj[k] = asset.addURLDependency(obj[k], {
          bundleBehavior: 'isolated',
          loc: {
            filePath,
            ...getJSONSourceLocation(ptrs[location + '/' + k], 'value'),
          },
          pipeline: path.extname(obj[k]) == '.json' ? 'raw' : undefined,
        });
      }
    }
  }
  if (isMV2) {
    if (program.background?.page) {
      program.background.page = asset.addURLDependency(
        program.background.page,
        {
          bundleBehavior: 'isolated',
          loc: {
            filePath,
            ...getJSONSourceLocation(ptrs['/background/page'], 'value'),
          },
        },
      );
      if (needRuntimeBG) {
        asset.meta.webextBGInsert = program.background.page;
      }
    }
    if (hot) {
      // To enable HMR, we must override the CSP to allow 'unsafe-eval'
      program.content_security_policy = cspPatchHMR(
        program.content_security_policy,
      );

      if (needRuntimeBG && !program.background?.page) {
        if (!program.background) {
          program.background = {};
        }
        if (!program.background.scripts) {
          program.background.scripts = [];
        }
        if (program.background.scripts.length == 0) {
          program.background.scripts.push(
            asset.addURLDependency('./runtime/default-bg.js', {
              resolveFrom: __filename,
            }),
          );
        }
        asset.meta.webextBGInsert = program.background.scripts[0];
      }
    }
  } else {
    if (program.background?.service_worker) {
      program.background.service_worker = asset.addURLDependency(
        program.background.service_worker,
        {
          bundleBehavior: 'isolated',
          loc: {
            filePath,
            ...getJSONSourceLocation(
              ptrs['/background/service_worker'],
              'value',
            ),
          },
          env: {
            context: 'service-worker',
            sourceType:
              program.background.type == 'module' ? 'module' : 'script',
          },
        },
      );
    }
    if (hot) {
      // Enable eval HMR for sandbox,
      const csp = program.content_security_policy || {};
      csp.extension_pages = cspPatchHMR(
        csp.extension_pages,
        `http://${hmrOptions?.host || 'localhost'}`,
      );
      // Sandbox allows eval by default
      if (csp.sandbox) csp.sandbox = cspPatchHMR(csp.sandbox);
      program.content_security_policy = csp;
      if (needRuntimeBG) {
        if (!program.background) {
          program.background = {};
        }
        if (!program.background.service_worker) {
          program.background.service_worker = asset.addURLDependency(
            './runtime/default-bg.js',
            {
              resolveFrom: __filename,
              env: {context: 'service-worker'},
            },
          );
        }
        asset.meta.webextBGInsert = program.background.service_worker;
      }
    }
  }
}

function cspPatchHMR(policy: ?string, insert?: string) {
  let defaultSrc = "'self'";
  if (insert == null) {
    insert = "'unsafe-eval'";
    defaultSrc = "'self' blob: filesystem:";
  }
  if (policy) {
    const csp = parseCSP(policy);
    policy = '';
    if (!csp['script-src']) {
      csp['script-src'] = [defaultSrc];
    }
    if (!csp['script-src'].includes(insert)) {
      csp['script-src'].push(insert);
    }
    if (csp.sandbox && !csp.sandbox.includes('allow-scripts')) {
      csp.sandbox.push('allow-scripts');
    }
    for (const k in csp) {
      policy += `${k} ${csp[k].join(' ')};`;
    }
    return policy;
  } else {
    return `script-src ${defaultSrc} ${insert};` + `object-src ${defaultSrc};`;
  }
}

export default (new Transformer({
  async transform({asset, options}) {
    // Set environment to browser, since web extensions are always used in
    // browsers, and because it avoids delegating extra config to the user
    asset.setEnvironment({
      context: 'browser',
      outputFormat:
        asset.env.outputFormat == 'commonjs'
          ? 'global'
          : asset.env.outputFormat,
      engines: {
        browsers: asset.env.engines.browsers,
      },
      sourceMap: asset.env.sourceMap && {
        ...asset.env.sourceMap,
        inline: true,
        inlineSources: true,
      },
      includeNodeModules: asset.env.includeNodeModules,
      sourceType: asset.env.sourceType,
      isLibrary: asset.env.isLibrary,
      shouldOptimize: asset.env.shouldOptimize,
      shouldScopeHoist: asset.env.shouldScopeHoist,
    });
    const code = await asset.getCode();
    const parsed = parse(code);
    const data: any = parsed.data;

    // Not using a unified schema dramatically improves error messages
    let schema = VersionSchema;
    if (data.manifest_version === 3) {
      schema = MV3Schema;
    } else if (data.manifest_version === 2) {
      schema = MV2Schema;
    }

    validateSchema.diagnostic(
      schema,
      {
        data: data,
        source: code,
        filePath: asset.filePath,
      },
      '@parcel/transformer-webextension',
      'Invalid Web Extension manifest',
    );
    await collectDependencies(asset, data, parsed.pointers, options.hmrOptions);
    asset.setCode(JSON.stringify(data, null, 2));
    asset.meta.webextEntry = true;
    return [asset];
  },
}): Transformer);
