const SYMBOL_NAME = /^[A-Za-z_$][\w$]{0,99}$/;

export function isSymbolName(name: string): boolean {
  return SYMBOL_NAME.test(name);
}
