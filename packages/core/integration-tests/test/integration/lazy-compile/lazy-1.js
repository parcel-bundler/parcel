export default async () => {
    const { world } = await import('./lazy-2');
    return `Hello ${world}`;
}