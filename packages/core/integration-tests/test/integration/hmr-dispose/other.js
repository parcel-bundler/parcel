export const value = 1;
output(["eval:other", value, module.hot.data]);
module.hot.dispose((data) => {
  output(["dispose:other", value]);
  data.value = value;
})
