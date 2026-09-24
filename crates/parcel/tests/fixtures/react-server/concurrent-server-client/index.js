export default async function load() {
  const [server, client] = await Promise.all([
    import('./server'),
    import('./client'),
  ]);
  return [server.Server, client.Client];
}
