let $module;

async function handle(data) {
  let idx = data.idx;
  let child = data.child;
  let method = data.method;
  let args = data.args;
  let isResponse = data.type === 'response';

  let result = {idx, child};

  try {
    result.content = await $module[method](...args);
    result.type = 'result';
  } catch (e) {
    result.content = {
      message: e.message,
      stack: e.stack,
      name: e.name
    };
    // Add all custom codeFrame properties
    Object.keys(e).forEach(key => {
      result.content[key] = e[key];
    });
    result.type = 'error';
  }

  if (!isResponse) {
    process.send(result, err => {
      if (err && err instanceof Error) {
        if (err.code === 'ERR_IPC_CHANNEL_CLOSED') {
          // Master process ended early, no need to worry master should be done with it anyway
          // Close this process as it can no longer reach the master
          console.warn('IPC Connection closed early, shutting down worker.');
          return process.exit(0);
        }
      }
    });
  }
}

process.on('message', function(data) {
  if (!$module) {
    if (data.module) {
      $module = require(data.module);
      if (!isNaN(data.child) && $module.setId) {
        $module.setId(data.child);
      }
    }
    return;
  }
  if (data === 'die') {
    return process.exit(0);
  }
  handle(data);
});
