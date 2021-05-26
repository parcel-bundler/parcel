function fibonacci(fib) {
  if (fib <= 1) return 1;
  return fibonacci(fib - 1) + fibonacci(fib - 2);
}

export {fibonacci as fib};
