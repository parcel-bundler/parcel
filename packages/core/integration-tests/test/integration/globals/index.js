module.exports = function () {
  return {
    dir: __dirname,
    file: __filename,
    buf: Buffer.from(process.title).toString('base64'),
    global: !!global.document
  };
};
