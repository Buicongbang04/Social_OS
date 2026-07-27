import {
  ValidationError,
  isId,
  type IdOf,
  type IdPrefixName,
} from "@repo/core";

/**
 * Narrow an untrusted route param into a branded ID.
 *
 * `assertId` from @repo/core throws a TypeError, which AllExceptionsFilter can
 * only treat as an unclassified failure — so a user typing a malformed id
 * would produce a 500 and page whoever is on call. A malformed id is a client
 * error, so this raises ValidationError (400) instead.
 */
export function parseRouteId<TName extends IdPrefixName>(
  name: TName,
  value: string,
  field = "id",
): IdOf<TName> {
  if (!isId(name, value)) {
    throw new ValidationError(`Invalid ${name} id.`, [
      { field, message: `Expected a ${name} id, got "${value}".` },
    ]);
  }
  return value;
}
