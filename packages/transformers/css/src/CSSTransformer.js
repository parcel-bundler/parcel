// @flow

import type {Root} from 'postcss';
import type {FilePath, MutableAsset, PluginOptions} from '@parcel/types';

import {hashString} from '@parcel/hash';
import SourceMap from '@parcel/source-map';
import {Transformer} from '@parcel/plugin';
import {createDependencyLocation, remapSourceLocation} from '@parcel/utils';
import postcss from 'postcss';
import nullthrows from 'nullthrows';
import valueParser from 'postcss-value-parser';
import semver from 'semver';
import path from 'path';

const URL_RE = /url\s*\(/;
const IMPORT_RE = /@import/;
const COMPOSES_RE = /composes:.+from\s*("|').*("|')\s*;?/;
const FROM_IMPORT_RE = /.+from\s*(?:"|')(.*)(?:"|')\s*;?/;
const MODULE_BY_NAME_RE = /\.module\./;

function canHaveDependencies(filePath: FilePath, code: string) {
  return !/\.css$/.test(filePath) || IMPORT_RE.test(code) || URL_RE.test(code);
}

export default (new Transformer({
  canReuseAST({ast}) {
    return ast.type === 'postcss' && semver.satisfies(ast.version, '^8.2.1');
  },

  async parse({asset}) {
    // This is set by other transformers (e.g. Stylus) to indicate that it has already processed
    // all dependencies, and that the CSS transformer can skip this asset completely. This is
    // required because when stylus processes e.g. url() it replaces them with a dependency id
    // to be filled in later. When the CSS transformer runs, it would pick that up and try to
    // resolve a dependency for the id which obviously doesn't exist. Also, it's faster to do
    // it this way since the resulting CSS doesn't need to be re-parsed.
    let isCSSModule =
      asset.meta.cssModulesCompiled !== true &&
      MODULE_BY_NAME_RE.test(asset.filePath);
    if (asset.meta.hasDependencies === false && !isCSSModule) {
      return null;
    }

    let code = await asset.getCode();
    if (
      code != null &&
      !canHaveDependencies(asset.filePath, code) &&
      !isCSSModule
    ) {
      return null;
    }

    return {
      type: 'postcss',
      version: '8.2.1',
      program: postcss
        .parse(code, {
          from: asset.filePath,
        })
        .toJSON(),
    };
  },

  async transform({asset, resolve, options}) {
    // Normalize the asset's environment so that properties that only affect JS don't cause CSS to be duplicated.
    // For example, with ESModule and CommonJS targets, only a single shared CSS bundle should be produced.
    let env = asset.env;
    asset.setEnvironment({
      context: 'browser',
      engines: {
        browsers: asset.env.engines.browsers,
      },
      shouldOptimize: asset.env.shouldOptimize,
      sourceMap: asset.env.sourceMap,
    });

    let isCSSModule =
      asset.meta.cssModulesCompiled !== true &&
      MODULE_BY_NAME_RE.test(asset.filePath);

    // Check for `hasDependencies` being false here as well, as it's possible
    // another transformer (such as PostCSSTransformer) has already parsed an
    // ast and CSSTransformer's parse was never called.
    let ast = await asset.getAST();
    if (!ast || (asset.meta.hasDependencies === false && !isCSSModule)) {
      return [asset];
    }

    let program: Root = postcss.fromJSON(ast.program);
    let assets = [asset];
    if (isCSSModule) {
      assets = await compileCSSModules(asset, env, program, resolve, options);
    }

    if (asset.meta.hasDependencies === false) {
      return assets;
    }

    let originalSourceMap = await asset.getMap();
    let createLoc = (start, specifier, lineOffset, colOffset, o) => {
      let loc = createDependencyLocation(
        start,
        specifier,
        lineOffset,
        colOffset,
        o,
      );
      if (originalSourceMap) {
        loc = remapSourceLocation(loc, originalSourceMap);
      }
      return loc;
    };

    let isDirty = false;
    program.walkAtRules('import', rule => {
      let params = valueParser(rule.params);
      let [name, ...media] = params.nodes;
      let specifier;
      if (
        name.type === 'function' &&
        name.value === 'url' &&
        name.nodes.length
      ) {
        name = name.nodes[0];
      }

      specifier = name.value;

      if (!specifier) {
        throw new Error('Could not find import name for ' + String(rule));
      }

      // If this came from an inline <style> tag, don't inline the imported file. Replace with the correct URL instead.
      // TODO: run CSSPackager on inline style tags.
      // let inlineHTML =
      //   this.options.rendition && this.options.rendition.inlineHTML;
      // if (inlineHTML) {
      //   name.value = asset.addURLDependency(dep, {loc: rule.source.start});
      //   rule.params = params.toString();
      // } else {
      media = valueParser.stringify(media).trim();
      let dep = {
        specifier,
        specifierType: 'url',
        // Offset by 8 as it does not include `@import `
        loc: createLoc(nullthrows(rule.source.start), specifier, 0, 8),
        meta: {
          // For the glob resolver to distinguish between `@import` and other URL dependencies.
          isCSSImport: true,
          media,
        },
      };
      asset.addDependency(dep);
      rule.remove();
      // }
      isDirty = true;
    });

    program.walkDecls(decl => {
      if (URL_RE.test(decl.value)) {
        let parsed = valueParser(decl.value);
        let isDeclDirty = false;

        parsed.walk(node => {
          if (
            node.type === 'function' &&
            node.value === 'url' &&
            node.nodes.length > 0 &&
            !node.nodes[0].value.startsWith('#') // IE's `behavior: url(#default#VML)`
          ) {
            let urlNode = node.nodes[0];
            let url = asset.addURLDependency(urlNode.value, {
              loc:
                decl.source &&
                decl.source.start &&
                createLoc(
                  decl.source.start,
                  urlNode.value,
                  0,
                  decl.source.start.offset + urlNode.sourceIndex + 1,
                  0,
                ),
            });
            isDeclDirty = urlNode.value !== url;
            urlNode.type = 'string';
            urlNode.quote = '"';
            urlNode.value = url;
          }
        });

        if (isDeclDirty) {
          decl.value = parsed.toString();
          isDirty = true;
        }
      }
    });

    if (isDirty) {
      asset.setAST({
        ...ast,
        program: program.toJSON(),
      });
    }

    return assets;
  },

  async generate({asset, ast, options}) {
    let result = await postcss().process(postcss.fromJSON(ast.program), {
      from: undefined,
      to: options.projectRoot + '/index',
      map: {
        annotation: false,
        inline: false,
        sourcesContent: false,
      },
      // Pass postcss's own stringifier to it to silence its warning
      // as we don't want to perform any transformations -- only generate
      stringifier: postcss.stringify,
    });

    let map = null;
    let originalSourceMap = await asset.getMap();
    if (result.map != null) {
      map = new SourceMap(options.projectRoot);
      map.addVLQMap(result.map.toJSON());
      if (originalSourceMap) {
        map.extends(originalSourceMap.toBuffer());
      }
    } else {
      map = originalSourceMap;
    }

    return {
      content: result.css,
      map,
    };
  },
}): Transformer);

async function compileCSSModules(asset, env, program, resolve, options) {
  let cssModules;

  let code = asset.isASTDirty() ? null : await asset.getCode();
  if (code == null || COMPOSES_RE.test(code)) {
    program.walkDecls(decl => {
      let [, importPath] = FROM_IMPORT_RE.exec(decl.value) || [];
      if (decl.prop === 'composes' && importPath != null) {
        let parsed = valueParser(decl.value);
        let start = (decl.source.start: any);

        parsed.walk(node => {
          if (node.type === 'string') {
            asset.addDependency({
              specifier: importPath,
              specifierType: 'url',
              loc: start
                ? {
                    filePath: asset.filePath,
                    start,
                    end: {
                      line: start.line,
                      column: start.column + importPath.length,
                    },
                  }
                : undefined,
            });
          }
        });
      }
    });
  }

  let postcssModules = await options.packageManager.require(
    'postcss-modules',
    asset.filePath,
    {
      range: '^4.3.0',
      saveDev: true,
      shouldAutoInstall: options.shouldAutoInstall,
    },
  );

  let {root} = await postcss([
    postcssModules({
      getJSON: (filename, json) => (cssModules = json),
      Loader: await createLoader(asset, resolve, options),
      generateScopedName: (name, filename) =>
        `${name}_${hashString(
          path.relative(options.projectRoot, filename),
        ).substr(0, 6)}`,
    }),
  ]).process(program, {from: asset.filePath, to: asset.filePath});
  asset.setAST({
    type: 'postcss',
    version: '8.2.1',
    program: root.toJSON(),
  });

  let assets = [asset];
  if (cssModules) {
    // $FlowFixMe
    let cssModulesList = (Object.entries(cssModules): Array<[string, string]>);
    let deps = asset.getDependencies().filter(dep => dep.priority === 'sync');
    let code: string;
    if (deps.length > 0) {
      code = `
        module.exports = Object.assign({}, ${deps
          .map(dep => `require(${JSON.stringify(dep.specifier)})`)
          .join(', ')}, ${JSON.stringify(cssModules, null, 2)});
      `;
    } else {
      code = cssModulesList
        .map(
          // This syntax enables shaking the invidual statements, so that unused classes don't even exist in JS.
          ([className, classNameHashed]) =>
            `module.exports[${JSON.stringify(className)}] = ${JSON.stringify(
              classNameHashed,
            )};`,
        )
        .join('\n');
    }

    asset.symbols.ensure();
    for (let [k, v] of cssModulesList) {
      asset.symbols.set(k, v);
    }
    asset.symbols.set('default', 'default');

    assets.push({
      type: 'js',
      content: code,
      env,
    });
  }
  return assets;
}

async function createLoader(
  asset: MutableAsset,
  resolve: (from: FilePath, to: string) => Promise<FilePath>,
  options: PluginOptions,
) {
  let {default: FileSystemLoader} = await options.packageManager.require(
    'postcss-modules/build/css-loader-core/loader',
    asset.filePath,
  );
  return class ParcelFileSystemLoader extends FileSystemLoader {
    async fetch(composesPath, relativeTo) {
      let importPath = composesPath.replace(/^["']|["']$/g, '');
      let resolved = await resolve(relativeTo, importPath);
      let rootRelativePath = path.resolve(path.dirname(relativeTo), resolved);
      let root = path.resolve('/');
      // fixes an issue on windows which is part of the css-modules-loader-core
      // see https://github.com/css-modules/css-modules-loader-core/issues/230
      if (rootRelativePath.startsWith(root)) {
        rootRelativePath = rootRelativePath.substr(root.length);
      }

      let source = await asset.fs.readFile(resolved, 'utf-8');
      let {exportTokens} = await this.core.load(
        source,
        rootRelativePath,
        undefined,
        // $FlowFixMe[method-unbinding]
        this.fetch.bind(this),
      );
      return exportTokens;
    }

    get finalSource() {
      return '';
    }
  };
}
