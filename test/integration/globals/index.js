module.exports = function () {
  return {
    dir: __dirname,
    file: __filename,
    buf: new Buffer(process.title).toString('base64'),
    global: !!global.document
  };
};
