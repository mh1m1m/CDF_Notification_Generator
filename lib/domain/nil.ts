/**
 * lib/domain/nil.ts — the one null-or-undefined test used by the domain modules (the repository's eqeqeq rule forbids
 * `== null`). A type predicate, so it narrows like the loose comparison it replaces.
 */
export const isNil = (v: unknown): v is null | undefined => v === null || v === undefined;
