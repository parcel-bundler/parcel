export function generateMainCode(originalSpecifier, methods) {
  let methodsStr = `['${methods.join("','")}']`;
  return `
    const methods = ${methodsStr};

    export default function createWorker() {
      let counter = 0;
      let callbacks = {};
      let worker = new Worker(new URL(${JSON.stringify(
        originalSpecifier,
      )}, import.meta.url));
      let term = worker.terminate;
      worker.kill = signal => {
        worker.postMessage({ type: 'KILL', signal });
        setTimeout(worker.terminate);
      };
      worker.terminate = () => {
        term.call(worker);
      };
      worker.call = (method, params) => new Promise( (resolve, reject) => {
        let id = 'rpc' + ++counter;
        callbacks[id] = [resolve, reject];
        worker.postMessage({ type: 'RPC', id, method, params });
      });
      for (let methodName of methods) {
        worker[methodName] = function() {
          return worker.call(methodName, [].slice.call(arguments));
        };
      }
      worker.addEventListener('message', ({ data }) => {
        let id = data.id;
        let callback = callbacks[id];
        if (callback==null) throw Error('Unknown callback ' + id);
        delete callbacks[id];
        if (data.error) callback[1](Error(data.error));
        else callback[0](data.result);
      })
      return worker;
    }
  `;
}

export function generateWorkerCode() {
  return `
    import * as worker from 'workerize-original-worker';

    export const messageHandler = ({ data }) => {
      const { id, method, params } = data;
      if (data.type!=='RPC' || id==null) return; // ? Do we need this?
      if (data.method) {
        let method = worker[data.method];
        if (method==null) {
          self.postMessage({ type: 'RPC', id, error: 'NO_SUCH_METHOD' });
        }
        else {
          Promise.resolve()
            .then( () => method.apply(null, data.params) )
            .then( result => { self.postMessage({ type: 'RPC', id, result }); })
            .catch( err => { self.postMessage({ type: 'RPC', id, error: ''+err }); });
        }
      }
    };

    self.addEventListener('message', messageHandler);
  `;
}
