export function keyByPosition(event: { key: string; code: string }): string {
  return /^Key[A-Z]$/.test(event.code) ? event.code.slice(3).toLowerCase() : event.key;
}
