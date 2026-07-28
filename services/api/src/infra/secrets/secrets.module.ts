import { Global, Module } from "@nestjs/common";
import { Keyring } from "@repo/secrets";
import { SecretChanges } from "./secret-changes";

/**
 * The keyring, or nothing.
 *
 * Null when no key is configured, and the API still boots — everything that
 * does not touch a stored credential keeps working. What it must not do is
 * invent a key: values sealed with one that disappears on restart are values
 * nobody can read again, and the failure only surfaces later.
 */
export const KEYRING = Symbol("KEYRING");

@Global()
@Module({
  providers: [
    { provide: KEYRING, useFactory: (): Keyring | null => Keyring.fromEnv() },
    SecretChanges,
  ],
  exports: [KEYRING, SecretChanges],
})
export class SecretsInfraModule {}
