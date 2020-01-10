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

console.log(`This internal Atlassian build of Parcel includes telemetry recording important
events that occur, such as as when builds start, progress, and end in either success or failure.

This telemetry includes information such as your os username (staffid), memory and cpu usage,
and when events occurred.

Details about user-triggered errors such as syntax errors should not be included in these reports.

Source code for our version of Parcel is available at https://staging.bb-inf.net/padmaia/parcel/src/master/
`);

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
