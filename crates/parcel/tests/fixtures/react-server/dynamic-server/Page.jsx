async function Server() {
  let {Dynamic} = await import('./Dynamic');
  return <Dynamic />;
}
output = {Server};
