import {AtlaspackWatcherWatchmanJS} from './wrapper';

const wrapper = new AtlaspackWatcherWatchmanJS();

export const writeSnapshot = wrapper.writeSnapshot.bind(wrapper);
export const getEventsSince = wrapper.getEventsSince.bind(wrapper);
export const subscribe = wrapper.subscribe.bind(wrapper);
export const unsubscribe = wrapper.unsubscribe.bind(wrapper);
