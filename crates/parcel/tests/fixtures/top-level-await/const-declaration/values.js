await 0;
const c = 1;
export let reassigned;
try {
  c = 2;
} catch (err) {
  reassigned = err.name;
}
