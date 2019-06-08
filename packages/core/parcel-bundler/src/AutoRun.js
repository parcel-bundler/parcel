const {fork} = require('child_process');

class AutoRun {
  constructor(bundler) {
    this.bundler = bundler;

    bundler.on('bundled', async bundle => {
      if (this.previousRun) {
        this.previousRun.kill();
      }
      this.run(bundle);
    });

    bundler.bundle();
  }

  run(bundle) {
    if (!bundle.name) {
      return;
    }
    this.previousRun = fork(bundle.name);
  }
}

module.exports = AutoRun;
