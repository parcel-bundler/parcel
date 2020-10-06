// @flow
import path from 'path';
import {Transformer} from '@parcel/plugin';
import SourceMap from '@parcel/source-map';

import {load, preSerialize} from './loadConfig';

// E.g: ~library/file.less
const WEBPACK_ALIAS_RE = /^~[^/]/;

type LessConfig = {
  sourceMap: any,
  filename: string,
  plugins: Array<any>,
  ...
};

type LessFileInfo = {|
  rewriteUrls?: boolean,
  filename: string,
  rootpath: string,
  currentDirectory: string,
  rootFilename: string,
  entryPath: string,
  reference?: boolean,
|};

type LessContext = {...};

interface LessVisitor {
  visit(value: LessNode): LessNode;
}

interface LessNode {
  parent: ?LessNode;
  visibilityBlocks: ?number;
  nodeVisible: ?boolean;
  rootNode: ?LessNode;
  parsed: ?boolean;

  +currentFileInfo: LessFileInfo;
  +index: number;

  setParent(nodes: LessNode | Array<LessNode>, parent: LessNode): void;

  getIndex(): number;
  fileInfo(): LessFileInfo;
  isRulesetLike(): boolean;

  toCSS(context: LessContext): string;
  genCSS(context: LessContext, output: mixed): void;
  accept(visitor: LessVisitor): void;
  eval(): mixed;

  fround(context: LessContext, value: number): number;
  blocksVisibility(): boolean;
  addVisibilityBlock(): void;
  removeVisibilityBlock(): void;
  ensureVisibility(): void;
  ensureInvisibility(): void;
  isVisible(): ?boolean;
  visibilityInfo(): {|visibilityBlocks: ?number, nodeVisible: ?boolean|};
  copyVisibilityInfo(info: {
    visibilityBlocks: ?number,
    nodeVisible: ?boolean,
    ...
  }): void;
}

interface LessURL extends LessNode {
  value: LessNode;
  isEvald: boolean;
}

// This is a hack; no such interface exists, even conceptually, in Less.
interface LessNodeWithValue extends LessNode {
  value: any;
}

export default (new Transformer({
  loadConfig({config}) {
    return load({config});
  },

  preSerializeConfig({config}) {
    return preSerialize(config);
  },

  async transform({asset, options, config, resolve}) {
    asset.type = 'css';
    asset.meta.hasDependencies = false;

    let less = await options.packageManager.require('less', asset.filePath, {
      autoinstall: options.autoinstall,
    });

    let code = await asset.getCode();
    let result;
    try {
      let lessConfig: LessConfig = config ? {...config.config} : {};

      if (options.sourceMaps) {
        lessConfig.sourceMap = {};
      }

      lessConfig.filename = asset.filePath;
      lessConfig.plugins = [
        ...(lessConfig.plugins || []),
        urlPlugin({asset}),
        resolvePathPlugin({asset, resolve}),
      ];

      result = await less.render(code, lessConfig);
    } catch (err) {
      // For the error reporter
      err.fileName = err.filename;
      err.loc = {
        line: err.line,
        column: err.column,
      };
      throw err;
    }

    if (result.map != null) {
      let map = new SourceMap(options.projectRoot);
      let rawMap = JSON.parse(result.map);
      map.addRawMappings({
        ...rawMap,
        sources: rawMap.sources.map(s => path.relative(options.projectRoot, s)),
      });
      asset.setMap(map);
    }

    asset.setCode(result.css);

    return [asset];
  },
}): Transformer);

function urlPlugin({asset}) {
  return {
    install(less, pluginManager) {
      const visitor = new less.visitors.Visitor({
        visitUrl(node: LessURL) {
          const valueNode = ((node.value: any): LessNodeWithValue);
          const stringValue = (valueNode.value: string);
          if (
            !stringValue.startsWith('#') // IE's `behavior: url(#default#VML)`)
          ) {
            valueNode.value = asset.addURLDependency(stringValue, {});
          }
          return node;
        },
      });

      visitor.run = visitor.visit;
      pluginManager.addVisitor(visitor);
    },
  };
}

function resolvePathPlugin({asset, resolve}) {
  return {
    install(less, pluginManager) {
      class LessFileManager extends less.FileManager {
        supports() {
          return true;
        }

        supportsSync() {
          return false;
        }

        async loadFile(rawFilename, ...args) {
          let filename = rawFilename;

          if (WEBPACK_ALIAS_RE.test(filename)) {
            let correctPath = filename.replace(/^~/, '');
            throw new Error(
              `The @import path "${filename}" is using webpack specific syntax, which isn't supported by Parcel.\n\nTo @import files from node_modules, use "${correctPath}"`,
            );
          }

          try {
            return await super.loadFile(filename, ...args);
          } catch (err) {
            if (err.type !== 'File') {
              throw err;
            }
            filename = await resolve(asset.filePath, filename);
            return super.loadFile(filename, ...args);
          }
        }
      }

      pluginManager.addFileManager(new LessFileManager());
    },
  };
}
