// @flow strict-local

import type {AST, Blob} from '@parcel/types';
import type {ParcelOptions} from './types';
import type {AssetAddr} from '@parcel/rust';

import {Readable} from 'stream';
import SourceMap from '@parcel/source-map';
import {bufferStream, blobToStream, streamFromPromise} from '@parcel/utils';
import {generateFromAST} from './assetUtils';
import {Asset as DbAsset, AssetFlags} from '@parcel/rust';
import {deserializeRaw} from './serializer';
import type BundleGraph from './BundleGraph';
import type {Scope} from './scopeCache';

export default class CommittedAsset {
  value: DbAsset;
  options: ParcelOptions;
  content: ?Promise<Buffer | string>;
  mapBuffer: ?Promise<?Buffer>;
  map: ?Promise<?SourceMap>;
  ast: ?Promise<AST>;
  idBase: ?string;
  generatingPromise: ?Promise<void>;

  constructor(id: AssetAddr, options: ParcelOptions) {
    this.value = DbAsset.get(options.db, id);
    this.options = options;
  }

  getContent(): Blob | Promise<Buffer | string> {
    if (this.content == null) {
      if (this.value.contentKey != null) {
        if (this.value.flags & AssetFlags.LARGE_BLOB) {
          return this.options.cache.getStream(this.value.contentKey);
        } else {
          return this.options.cache.getBlob(this.value.contentKey);
        }
        // } else if (this.value.astKey != null) {
        //   return streamFromPromise(
        //     generateFromAST(this).then(({content}) => {
        //       if (!(content instanceof Readable)) {
        //         this.content = Promise.resolve(content);
        //       }
        //       return content;
        //     }),
        //   );
      } else {
        throw new Error('Asset has no content');
      }
    }

    return this.content;
  }

  async getCode(): Promise<string> {
    let content;
    if (this.content == null && this.value.contentKey != null) {
      this.content = this.options.cache.getBlob(this.value.contentKey);
      content = await this.content;
    } else {
      content = await this.getContent();
    }

    if (typeof content === 'string' || content instanceof Buffer) {
      return content.toString();
    } else if (content != null) {
      this.content = bufferStream(content);
      return (await this.content).toString();
    }

    return '';
  }

  async getBuffer(): Promise<Buffer> {
    let content = await this.getContent();

    if (content == null) {
      return Buffer.alloc(0);
    } else if (typeof content === 'string' || content instanceof Buffer) {
      return Buffer.from(content);
    }

    this.content = bufferStream(content);
    return this.content;
  }

  getStream(): Readable {
    let content = this.getContent();
    return content instanceof Promise
      ? streamFromPromise(content)
      : blobToStream(content);
  }

  getMapBuffer(bundleGraph: BundleGraph, scope: Scope): Promise<?Buffer> {
    let mapKey = this.value.mapKey;
    if (mapKey != null && this.mapBuffer == null) {
      this.mapBuffer = (async () => {
        try {
          return await this.options.cache.getBlob(mapKey);
        } catch (err) {
          if (err.code === 'ENOENT' && this.value.ast != null) {
            return (
              await generateFromAST(this, bundleGraph, scope)
            ).map?.toBuffer();
          } else {
            throw err;
          }
        }
      })();
    }

    return this.mapBuffer ?? Promise.resolve();
  }

  getMap(bundleGraph: BundleGraph, scope: Scope): Promise<?SourceMap> {
    if (this.map == null) {
      this.map = (async () => {
        let mapBuffer = await this.getMapBuffer(bundleGraph, scope);
        if (mapBuffer) {
          // Get sourcemap from flatbuffer
          return new SourceMap(this.options.projectRoot, mapBuffer);
        }
      })();
    }

    return this.map;
  }

  getAST(): Promise<?AST> {
    if (this.value.ast == null) {
      return Promise.resolve(null);
    }

    if (this.ast == null) {
      this.ast = this.options.cache
        .getBlob(this.value.ast.key)
        .then(serializedAst => deserializeRaw(serializedAst));
    }

    return this.ast;
  }
}
