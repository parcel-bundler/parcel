import {testingRunParcelJsTransformerPlugin} from '@parcel/rust';
import assert from 'node:assert';

describe('rust transformer', () => {
  if (!testingRunParcelJsTransformerPlugin) {
    return;
  }

  it('runs', async () => {
    const result = await testingRunParcelJsTransformerPlugin(__filename);
    assert(result != null);
  });
});
