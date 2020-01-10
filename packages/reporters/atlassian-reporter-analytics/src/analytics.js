// @flow

import Amplitude from 'amplitude';
import os from 'os';
// $FlowFixMe
import {performance} from 'perf_hooks';

const {username, shell} = os.userInfo();
let userProperties = {
  session_id: Date.now(),
  user_id: username,
  user_properties: {
    shell,
  },
};

let amplitude;
if (process.env.PARCEL_BUILD_ENV === 'production') {
  const amplitudeApiKey = process.env.AMPLITUDE_API_KEY;
  if (typeof amplitudeApiKey !== 'string') {
    throw new Error('Expected amplitude api key');
  }

  amplitude = new Amplitude(amplitudeApiKey, userProperties);
}

const analytics = {
  identify: (data: mixed) => {
    if (process.env.PARCEL_BUILD_ENV === 'production') {
      return amplitude.identify(data);
    }

    if (process.env.ANALYTICS_DEBUG != null) {
      console.log('analytics:identify', data);
      userProperties = {
        ...userProperties,
        ...data,
      };
    }

    return Promise.resolve();
  },
  track: (eventType: string, additionalEventProperties: mixed) => {
    const eventProperties = {
      ...additionalEventProperties,
      timestamp: performance.now(),
      argv: process.argv,
      memoryUsage: process.memoryUsage(),
    };

    if (process.env.PARCEL_BUILD_ENV === 'production') {
      return amplitude.track({
        event_type: eventType,
        event_properties: eventProperties,
      });
    }

    if (process.env.ANALYTICS_DEBUG != null) {
      console.log(
        'analytics:track',
        eventType,
        eventProperties,
        userProperties,
      );
    }

    return Promise.resolve();
  },

  trackSampled: (
    eventType: string,
    eventProperties: mixed,
    sampleRate: number,
  ) => {
    if (Math.random() < 1 / sampleRate) {
      return analytics.track(eventType, eventProperties);
    }
    return Promise.resolve();
  },
};

export default analytics;
