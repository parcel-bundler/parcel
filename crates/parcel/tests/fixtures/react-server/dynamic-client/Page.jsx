import './server.css';
async function Server() {
  let {Client} = await import('./Client');
  return <Client />;
}
output = {Server};
