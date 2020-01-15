// @flow
import type {BaseAsset} from '@parcel/types';

export type BabelError = Error & {
  loc?: {
    line: number,
    column: number,
    ...
  },
  source?: string,
  filePath?: string,
  ...
};

export async function babelErrorEnhancer(
  error: BabelError,
  asset: BaseAsset,
): Promise<BabelError> {
  if (error.loc) {
    error.message = error.message
      .slice(asset.filePath.length + 1, error.message.indexOf('\n'))
      .trim();
  }

  error.source = await asset.getCode();
  error.filePath = asset.filePath;

  return error;
}
