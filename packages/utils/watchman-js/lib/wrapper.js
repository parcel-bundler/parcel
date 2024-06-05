const fs = require('fs');
const path = require('path');
const watchman = require('fb-watchman');

exports.createWrapper = () => {
  const subscriptionName = 'parcel-watcher-subscription-' + Date.now();

  let client;
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

  return {
    // Types should match @parcel/watcher/index.js.flow
    writeSnapshot(dir, snapshot, opts) {
      return new Promise((resolve, reject) => {
        getClient().command(['clock', dir], function (error, resp) {
          if (error) {
            reject(error);
            return;
          }

          fs.writeFileSync(path.resolve(snapshot), resp.clock, {
            encoding: 'utf-8',
          });

          resolve();
        });
      });
    },

    getEventsSince(dir, snapshot, opts) {
      return new Promise((resolve, reject) => {
        const clock = fs.readFileSync(path.resolve(snapshot), {
          encoding: 'utf-8',
        });
        getClient().command(
          [
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
          ],
          function (error, resp) {
            if (error) {
              reject(error);
              return;
            }

            resolve(
              (resp.files || []).map(file => {
                return {
                  path: file.name,
                  type: file.new ? 'create' : file.exists ? 'update' : 'delete',
                };
              }),
            );
          },
        );
      });
    },

    subscribe(dir, fn, opts) {
      return new Promise((resolve, reject) => {
        getClient().command(['clock', dir], function (error, resp) {
          if (error) {
            reject(error);
            return;
          }
          getClient().command(
            [
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
                since: resp.clock,
              },
            ],
            function (error, resp) {
              if (error) {
                reject(error);
                return;
              }
            },
          );

          getClient().on('subscription', function (resp) {
            if (!resp.files || resp.subscription !== subscriptionName) {
              return;
            }

            fn(
              null /* err */,
              resp.files.map(file => {
                return {
                  path: path.join(dir, file.name),
                  type: file.new ? 'create' : file.exists ? 'update' : 'delete',
                };
              }),
            );
          });

          resolve({
            unsubscribe() {
              return new Promise(resolve => {
                getClient().command(
                  ['unsubscribe', dir, subscriptionName],
                  function () {
                    resolve();
                  },
                );
              });
            },
          });
        });
      });
    },

    unsubscribe(dir, fn, opts) {
      return new Promise(resolve => {
        getClient().command(
          ['unsubscribe', dir, subscriptionName],
          function () {
            resolve();
          },
        );
      });
    },
  };
};
