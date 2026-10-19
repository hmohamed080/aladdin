export async function register() {
  // Validate server-only storage settings before accepting requests.
  const { readStorageEnv } = await import("@/lib/env/storage");
  readStorageEnv();
}
