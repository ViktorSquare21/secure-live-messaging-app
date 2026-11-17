export function hasExactKeys(
  input: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): input is Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return false;
  const prototype: unknown = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const keys = Object.keys(input);
  if (!required.every((key) => keys.includes(key))) return false;
  return keys.every((key) => required.includes(key) || optional.includes(key));
}
