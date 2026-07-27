export function isNil<T>(
  value: T | null | undefined,
): value is null | undefined {
  return value === null || value === undefined;
}

export function isDefined<T>(value: T | null | undefined): value is T {
  return !isNil(value);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
