const {spawn} = require('child_process');

class AutoRun {
  constructor(bundler) {
    this.bundler = bundler;
    this.prog = null;

    this.selfStoppedPIDs = {};

    bundler.on('bundled', async bundle => {
      await this.clearPrevious();
      this.run(bundle);
    });

    bundler.bundle();
  }

  async clearPrevious() {
    if (this.prog) {
      this.prog.kill();
      this.selfStoppedPIDs[this.prog.pid] = true;
      await new Promise(resolve => {
        const intervalID = setInterval(() => {
          if (this.prog.killed) {
            resolve(clearInterval(intervalID));
          }
        }, 50);
      });
      return;
    }
  }

  run(bundle) {
    if (!bundle.name) {
      return;
    }
    this.prog = spawn('node', [bundle.name], {
      stdio: [process.stdin, process.stdout, process.stderr],
      detached: false
    });
    this.prog.on('close', code => {
      if (this.selfStoppedPIDs[this.prog.pid]) {
        delete this.selfStoppedPIDs[this.prog.pid];
      } else {
        process.exit(code);
      }
    });
  }
}

module.exports = AutoRun;
