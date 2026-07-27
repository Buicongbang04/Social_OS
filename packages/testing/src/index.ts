import { faker } from "@faker-js/faker";

export { faker };

/** Deterministic-looking fake UUID for fixtures/tests. */
export function fakeId(): string {
  return faker.string.uuid();
}

// Entity-specific factories (fakeWorkspace, fakeUser, ...) will be added
// alongside packages/domain in Giai đoạn 2 — see docs/development/05_TESTING_STRATEGY.md.
