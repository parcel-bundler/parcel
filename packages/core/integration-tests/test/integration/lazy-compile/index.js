async function main() {
    const m = await import('./lazy-1');
    await import('./parallel-lazy-1');
    return m.default();
}

main();