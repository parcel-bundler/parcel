import {testingRunParcelJsTransformerPlugin} from '@parcel/rust';
import assert from 'node:assert';

describe('rust transformer', () => {
  it('runs', async () => {
    const result = await testingRunParcelJsTransformerPlugin(__filename);
    assert(result != null);
  });
});
