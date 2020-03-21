```js
import Request from '../Request'
import whateverRequest from './whateverRequest';

export default new Request({
  type: 'some_request',
  hash: PARCEL_VERSION,
  options: {
  cleanupSubrequests, // false
  storeResult, // true
  },
  async run({
    request,
    prevResult,
    makeRequest,
    invalidateOnFileCreate,
    invalidateOnFileUpdate,
    invalidateOnFileDelete,
    requestEnv,
    requestOptions,
  }): {
    const whatever = await makeRequest(whateverRequest)(args);
  }
})
```
