export default async () => {
    const m = await import('./static-component');
    return m.default;
}