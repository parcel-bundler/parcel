if (typeof WebSocket !== 'undefined') {
  var WebSocketClient = function () {
    this.autoReconnectInterval = 5 * 1000;
    this.tryCount = 0;
    this.maximumTryCount = 5;
    this.onopen = this.onmessage = this.onclose = this.onerror
                = this.onreconnect = this.ongiveup = function () {};
    this.gaveup = false;
  }

  WebSocketClient.prototype.open = function (url) {
    var self = this;
    this.url = url;
    this.ws = new WebSocket(this.url);
    this.ws.onmessage = this.onmessage;
    this.ws.onopen = function (e) {
      self.tryCount = 0;
      self.gaveup = false;
      self.onopen(e);
    };
    this.ws.onclose = function (e) {
      self.onclose(e);
      if (e.code !== 1000) {
        self.reconnect(e);
      }
    };
    this.ws.onerror = function (e) {
      self.onerror(e);
      if (e.code === 'ECONNREFUSED') {
        self.reconnect(e);
      }
    };
  };

  WebSocketClient.prototype.reconnect = function (e) {
    var self = this
    if (!this.gaveup) {
      if (this.tryCount < this.maximumTryCount) {
        this.tryCount++;
        this.onreconnect(e);
        this.ws.onopen = this.ws.onmessage = this.ws.onclose = this.ws.onerror
                       = function () {};
        setTimeout(function () {
          self.open(self.url);
        }, this.autoReconnectInterval);
      } else {
        this.ongiveup(e);
        this.gaveup = true;
      }
    }
  };

  module.exports = WebSocketClient
} else {
  module.exports = undefined
}
