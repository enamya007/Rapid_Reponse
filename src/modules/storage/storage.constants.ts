// Injection token for the S3-compatible client used by StorageService. Keeping it behind a
// token (rather than injecting `S3Client` directly) lets tests provide a lightweight
// `{ send: jest.fn() }` stub with no network access.
export const STORAGE_S3_CLIENT = Symbol('STORAGE_S3_CLIENT');
