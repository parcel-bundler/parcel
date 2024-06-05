const {createWrapper} = require('./wrapper');

const wrapper = createWrapper();
exports.writeSnapshot = wrapper.writeSnapshot;
exports.getEventsSince = wrapper.getEventsSince;
exports.subscribe = wrapper.subscribe;
exports.unsubscribe = wrapper.unsubscribe;
