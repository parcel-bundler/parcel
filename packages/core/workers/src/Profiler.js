import inspector from 'inspector';

export default class Profiler {
  constructor() {
    this.session = undefined;
  }

  hasSession() {
    return this.session != null;
  }

  async startProfiling() {
    this.session = new inspector.Session();
    this.session.connect();

    return Promise.all([
      this.sendCommand('Profiler.setSamplingInterval', {
        interval: 100
      }),
      this.sendCommand('Profiler.enable'),
      this.sendCommand('Profiler.start'),
    ]);
  }

  async sendCommand(method, params) {
    if (this.hasSession()) {
      return new Promise((resolve, reject) => {
        this.session.post(method, params, (err, params) => {
          if (err == null) {
            resolve(params);
          } else {
            reject(err);
          }
        });
      });
    }
  }

  destroy() {
    if (this.hasSession()) {
      this.session.disconnect();
    }
  }

  async stopProfiling() {
    let res = await this.sendCommand('Profiler.stop');
    this.destroy();
    return res.profile;
  }
}
