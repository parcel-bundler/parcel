let $module;

function handle(data) {
  let idx = data.idx;
  let child = data.child;
  let method = data.method;
  let args = data.args;
  let callback = function() {
    let _args = Array.prototype.slice.call(arguments);
    if (_args[0] instanceof Error) {
      let e = _args[0];
      _args[0] = {
        $error: '$error',
        type: e.constructor.name,
        message: e.message,
        stack: e.stack
      };
      Object.keys(e).forEach(key => {
        _args[0][key] = e[key];
      });
    }
    process.send({idx: idx, child: child, args: _args});
  };
  let exec;
  if (method == null && typeof $module == 'function') {
    exec = $module;
  } else if (typeof $module[method] == 'function') {
    exec = $module[method];
  }

  if (!exec) {
    return console.error('NO SUCH METHOD:', method);
  }

  exec.apply(null, args.concat([callback]));
}

process.on('message', function(data) {
  if (!$module) {
    return ($module = require(data.module));
  }
  if (data == 'die') {
    return process.exit(0);
  }
  handle(data);
});
