export function verifyMediaBytes(bytes: Uint8Array, contentType: string, maxBytes: number): Promise<{ size: number; contentType: string; sha256: string }>;
export function readBoundedBody(response: Response, maxBytes: number): Promise<Uint8Array>;
export function withMediaProcessingSlot<T>(work: () => Promise<T>): Promise<T>;
