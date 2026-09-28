sideEffect('throws before');
await 0;
throw new Error('boom');
