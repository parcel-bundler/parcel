import {createWrapper} from './wrapper';

const wrapper = createWrapper();

export const writeSnapshot = wrapper.writeSnapshot.bind(wrapper);
export const getEventsSince = wrapper.getEventsSince.bind(wrapper);
export const subscribe = wrapper.subscribe.bind(wrapper);
export const unsubscribe = wrapper.unsubscribe.bind(wrapper);
