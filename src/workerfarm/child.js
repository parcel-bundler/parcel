const errorUtils = require('./errorUtils');

class Child {
  constructor() {
    this.module = undefined;
    this.childId = undefined;

    this.callQueue = [];
    this.responseQueue = new Map();
    this.responseId = 0;
    this.maxConcurrentCalls = 10;
  }

  messageListener(data) {
    if (data === 'die') {
      return this.end();
    }

    if (data.type === 'module' && data.module && !this.module) {
      this.module = require(data.module);
      this.childId = data.child;
      if (this.module.setChildReference) {
        this.module.setChildReference(this);
      }
      return;
    }

    let type = data.type;
    if (type === 'response') {
      return this.handleResponse(data);
    } else if (type === 'request') {
      return this.handleRequest(data);
    }
  }

  async send(data) {
    process.send(data, err => {
      if (err && err instanceof Error) {
        if (err.code === 'ERR_IPC_CHANNEL_CLOSED') {
          // IPC connection closed
          // no need to keep the worker running if it can't send or receive data
          return this.end();
        }
      }
    });
  }

  async handleRequest(data) {
    let idx = data.idx;
    let child = data.child;
    let method = data.method;
    let args = data.args;

    let result = {idx, child, type: 'response'};
    try {
      result.contentType = 'data';
      result.content = await this.module[method](...args);
    } catch (e) {
      result.contentType = 'error';
      result.content = errorUtils.errorToJson(e);
    }

    this.send(result);
  }

  async handleResponse(data) {
    let idx = data.idx;
    let contentType = data.contentType;
    let content = data.content;
    let call = this.responseQueue.get(idx);

    if (contentType === 'error') {
      call.reject(errorUtils.jsonToError(content));
    } else {
      call.resolve(content);
    }

    this.responseQueue.delete(idx);

    // Process the next call
    this.processQueue();
  }

  // Keep in mind to make sure responses to these calls are JSON.Stringify safe
  async addCall(request, awaitResponse = true) {
    let call = request;
    call.type = 'request';
    call.child = this.childId;
    call.awaitResponse = awaitResponse;

    let promise;
    if (awaitResponse) {
      promise = new Promise((resolve, reject) => {
        call.resolve = resolve;
        call.reject = reject;
      });
    }

    this.callQueue.push(call);
    this.processQueue();

    return promise;
  }

  async sendRequest(call) {
    let idx;
    if (call.awaitResponse) {
      idx = this.responseId++;
      this.responseQueue.set(idx, call);
    }
    this.send({
      idx: idx,
      child: call.child,
      type: call.type,
      location: call.location,
      method: call.method,
      args: call.args,
      awaitResponse: call.awaitResponse
    });
  }

  async processQueue() {
    if (!this.callQueue.length) {
      return;
    }

    if (this.responseQueue.size < this.maxConcurrentCalls) {
      this.sendRequest(this.callQueue.shift());
    }
  }

  end() {
    return process.exit(0);
  }
}

let child = new Child();
process.on('message', child.messageListener.bind(child));

module.exports = child;
