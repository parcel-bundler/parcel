const toBase64 = true
  ? btoa
  : (str) => Buffer.from(str.toString(), "binary").toString("base64");

function fromBase64(str){
  if(true){
    return atob(str);
  } else {
    return Buffer.from(str.toString(), "base64").toString("binary");
  }
}

module.exports = fromBase64(toBase64("foo"));
