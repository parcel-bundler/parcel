const watchman = require('fb-watchman');
const path = require('path');

class Watcher {
  constructor(root) {
    this.root = root;
    this.client = new watchman.Client();
  }

  init() {
    return new Promise((res, rej) =>
      this.client.command(['watch-project', this.root], (error, resp) => {
        if (error) {
          rej(error);
          return;
        }
        this.root = resp.watch;
        res(resp);
      })
    );
  }

  add(p) {
    p = path.relative(this.root, p);
    return new Promise((res, rej) =>
      this.client.command(['clock', this.root], (error, resp) => {
        if (error) {
          rej(error);
          return;
        }

        const sub = {
          expression: ['match', p, 'wholename'],
          fields: ['name', 'exists'],
          since: resp.clock // only log changes
        };

        this.client.command(
          ['subscribe', this.root, 'PARCEL:' + p, sub],
          (error, resp) => {
            if (error) {
              rej(error);
            }
            res(resp);
          }
        );
      })
    );
  }

  unwatch(p) {
    p = path.relative(this.root, p);
    return new Promise((res, rej) =>
      this.client.command(
        ['unsubscribe', this.root, 'PARCEL:' + p],
        (error, resp) => {
          if (error) {
            rej(error);
          }
          res(resp);
        }
      )
    );
  }

  on(event, callback) {
    if (event == 'change') {
      this.client.on('subscription', resp => {
        if (resp.subscription.indexOf('PARCEL:') != 0) return;

        resp.files.forEach(f => callback(path.join(resp.root, f.name)));
      });
    }
  }

  close() {
    this.client.end();
  }
}

module.exports = Watcher;
