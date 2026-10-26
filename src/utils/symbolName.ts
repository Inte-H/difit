// Identifiers in any script, such as Java method names written in Korean.
const SYMBOL_NAME = /^[\p{L}\p{Nl}_$][\p{L}\p{Nl}\p{Nd}\p{Mn}\p{Mc}\p{Pc}$]{0,99}$/u;

export function isSymbolName(name: string): boolean {
  return SYMBOL_NAME.test(name);
}
