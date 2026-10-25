import {Transformer, Diagnostic} from '@parcel/plugin';

export default new Transformer({
  transform({asset}) {
    throw new Diagnostic({
      message: 'Invalid data',
      codeFrames: [
        {
          filePath: asset.filePath,
          codeHighlights: [
            {start: {line: 2, column: 1}, end: {line: 2, column: 6}, message: 'here'},
          ],
        },
      ],
      hints: ['Fix the data'],
    });
  },
});
