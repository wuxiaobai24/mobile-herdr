export function isValidToken(value: unknown): value is string { return typeof value === 'string' && /^[\x21-\x7e]{8,4096}$/.test(value); }
