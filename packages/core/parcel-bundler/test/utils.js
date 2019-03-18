const {removeDistDirectory} = require('@parcel/test-utils');

beforeEach(async () => {
  await removeDistDirectory();
});
