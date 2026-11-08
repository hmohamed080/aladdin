export function findBrowser(kind: "chrome" | "edge"): string | null;
export function startRealBrowser(executable: string, options?: { extraArgs?: string[] }): Promise<{ cdpUrl: string; args: string[]; stop: () => void }>;
