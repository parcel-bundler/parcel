import * as fs from 'fs';
import * as path from 'path';
import * as watchman from 'fb-watchman';
import type {
  Options,
  getEventsSince,
  subscribe,
  unsubscribe,
  writeSnapshot,
  Event,
  SubscribeCallback,
  AsyncSubscription,
} from '@parcel/watcher';

export interface Watcher {
  getEventsSince: typeof getEventsSince;
  subscribe: typeof subscribe;
  unsubscribe: typeof unsubscribe;
  writeSnapshot: typeof writeSnapshot;
}

let client: watchman.Client | null = null;
function getClient() {
  if (!client) {
    client = new watchman.Client();
    client.capabilityCheck(
      {optional: [], required: ['relative_root']},
      function (error, resp) {
        if (error) {
          throw error;
        }
      },
    );
  }
  return client;
}

function commandAsync(args: any[]): Promise<any> {
  return new Promise((resolve, reject) => {
    const client = getClient();
    client.command(args, (err: Error | null | undefined, response: any) => {
      if (err) reject(err);
      else resolve(response);
    });
  });
}

class ParcelWatcherWatchmanJS implements Watcher {
  subscriptionName: string;

  constructor() {
    this.subscriptionName = 'parcel-watcher-subscription-' + Date.now();
  }

  // Types should match @parcel/watcher/index.js.flow
  async writeSnapshot(
    dir: string,
    snapshot: string,
    opts?: Options,
  ): Promise<string> {
    const response = await commandAsync(['clock', dir]);
    fs.writeFileSync(path.resolve(snapshot), response.clock, {
      encoding: 'utf-8',
    });
    return response.clock;
  }

  async getEventsSince(
    dir: string,
    snapshot: string,
    opts?: Options,
  ): Promise<Event[]> {
    // TODO: Handle ignore patterns here
    const clock = fs.readFileSync(path.resolve(snapshot), {
      encoding: 'utf-8',
    });

    const response = await commandAsync([
      'query',
      dir,
      {
        expression: [
          'not',
          [
            'anyof',
            ['dirname', '.hg'],
            ['dirname', '.git'],
            ['dirname', '.parcel-cache'],
            ['match', 'node_modules/**/*'],
          ],
        ],
        fields: ['name', 'mode', 'exists', 'new'],
        since: clock,
      },
    ]);

    return (response.files || []).map((file: any) => ({
      path: file.name,
      type: file.new ? 'create' : file.exists ? 'update' : 'delete',
    }));
  }

  async subscribe(
    dir: string,
    fn: SubscribeCallback,
    opts?: Options,
  ): Promise<AsyncSubscription> {
    const {subscriptionName} = this;
    const {clock} = await commandAsync(['clock', dir]);

    await commandAsync([
      'subscribe',
      dir,
      subscriptionName,
      {
        // `defer` can be used here if you want to pause the
        // notification stream until something has finished.
        //
        // https://facebook.github.io/watchman/docs/cmd/subscribe#defer
        // defer: ['my-company-example'],
        expression: [
          'not',
          [
            'anyof',
            ['dirname', '.hg'],
            ['dirname', '.git'],
            ['dirname', '.parcel-cache'],
            ['match', 'node_modules/**/*'],
          ],
        ],
        fields: ['name', 'mode', 'exists', 'new'],
        since: clock,
      },
    ]);

    getClient().on('subscription', function (resp) {
      if (!resp.files || resp.subscription !== subscriptionName) {
        return;
      }

      fn(
        null /* err */,
        resp.files.map((file: any) => {
          return {
            path: path.join(dir, file.name),
            type: file.new ? 'create' : file.exists ? 'update' : 'delete',
          };
        }),
      );
    });

    return {
      async unsubscribe() {
        return await commandAsync(['unsubscribe', dir, subscriptionName]);
      },
    };
  }

  async unsubscribe(
    dir: string,
    _fn: SubscribeCallback,
    _opts?: Options,
  ): Promise<void> {
    await commandAsync(['unsubscribe', dir, this.subscriptionName]);
  }
}

export function createWrapper(): Watcher {
  return new ParcelWatcherWatchmanJS();
}
