// @flow strict-local

import Amplitude from 'amplitude';
import os from 'os';

const {username, shell} = os.userInfo();
const userProperties = {
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
  identify: (data: {|[string]: mixed|}) => {
    if (process.env.ANALYTICS_DEBUG != null) {
      console.log('analytics:identify', data);
    }

    if (amplitude != null) {
      return amplitude.identify(data);
    }

    return Promise.resolve();
  },
  track: async (
    eventType: string,
    additionalEventProperties: {[string]: mixed, ...},
  ) => {
    const eventProperties = {
      ...additionalEventProperties,
      timestamp: new Date().toISOString(),
      argv: process.argv,
      memoryUsage: process.memoryUsage(),
    };

    if (process.env.ANALYTICS_DEBUG != null) {
      console.log('analytics:track', eventType, eventProperties);
    }

    if (amplitude != null) {
      try {
        return await amplitude.track({
          event_type: eventType,
          event_properties: eventProperties,
        });
      } catch {
        // Don't let a failure to report analytics crash Parcel
      }
    }
  },

  trackSampled: (
    eventType: string,
    eventProperties: {|[string]: mixed|} | (() => {[string]: mixed, ...}),
    sampleRate: number,
  ) => {
    if (Math.random() < 1 / sampleRate) {
      return analytics.track(eventType, {
        ...(typeof eventProperties === 'function'
          ? eventProperties()
          : eventProperties),
        sampleRate,
      });
    }
    return Promise.resolve();
  },
};

export default analytics;
