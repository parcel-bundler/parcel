export default async () => {
    const m = await import('./parallel-lazy-2');
    return m.default;
};