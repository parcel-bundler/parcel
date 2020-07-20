// @flow strict-local

import Amplitude from 'amplitude';

const userProperties = {
  session_id: Date.now(),
};

let amplitude;
if (
  process.env.PARCEL_BUILD_ENV === 'production' &&
  process.env.PARCEL_ANALYTICS_DISABLE == null
) {
  const amplitudeApiKey = process.env.AMPLITUDE_API_KEY;
  if (typeof amplitudeApiKey !== 'string') {
    throw new Error('Expected amplitude api key');
  }

  amplitude = new Amplitude(amplitudeApiKey, userProperties);
}

const COMMIT = process.env.BITBUCKET_COMMIT;

const analytics = {
  identify: (data: {|[string]: mixed|}): Promise<mixed> => {
    if (process.env.ANALYTICS_DEBUG != null) {
      // eslint-disable-next-line no-console
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
  ): Promise<mixed> => {
    const eventProperties = {
      ...additionalEventProperties,
      timestamp: new Date().toISOString(),
      memoryUsage: process.memoryUsage(),
      commit: COMMIT ?? null,
    };

    if (process.env.ANALYTICS_DEBUG != null) {
      // eslint-disable-next-line no-console
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
  ): Promise<mixed> => {
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
