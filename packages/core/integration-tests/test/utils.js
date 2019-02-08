const {removeDistDirectory} = require('@parcel/test-utils');

beforeEach(async function() {
  await removeDistDirectory();
});
