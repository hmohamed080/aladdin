/** Pure collection operations for future persisted gallery adapters. They grant no ownership or publication authority. */
export function moveMediaItem<T extends { id: string }>(items: readonly T[], id: string, direction: "up" | "down"): T[] {
  const index = items.findIndex((item) => item.id === id);
  const target = index + (direction === "up" ? -1 : 1);
  if (index < 0 || target < 0 || target >= items.length) return [...items];
  const result = [...items];
  [result[index], result[target]] = [result[target]!, result[index]!];
  return result;
}

export function chooseMediaCover<T extends { id: string }>(items: readonly T[], id: string): string | null {
  return items.some((item) => item.id === id) ? id : null;
}
