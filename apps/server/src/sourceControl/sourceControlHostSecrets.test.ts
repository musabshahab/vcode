import { assert, it } from "@effect/vitest";
import { SecretProviderId, UsageLimitSourceId } from "@codenine/contracts";
import * as SecretResolver from "@codenine/secret-provider-core/server/SecretResolver";
import * as Effect from "effect/Effect";

import {
  collectSourceControlHostSecretReferences,
  invalidateSettingsSecrets,
  resolveSourceControlHostSecrets,
} from "./sourceControlHostSecrets.ts";

const source = (reference: string) => ({
  provider: SecretProviderId.make("homelab"),
  reference,
});

const secretsByReference = new Map([["github#token", "ghp_from_provider"]]);

const perHostHosts = {
  github: { tokens: { "github.com": source("github#token"), "ghe.acme.test": "ghp_literal" } },
};

const hosts = {
  github: { tokens: { "github.com": "ghp_literal" } },
};

function countingResolver() {
  const reads: Array<string> = [];
  const resolver = SecretResolver.SecretResolver.of({
    label: (provider) => Effect.succeed(provider),
    read: (references) =>
      Effect.sync(() =>
        references.map((reference) => {
          reads.push(reference.reference);
          return secretsByReference.get(reference.reference);
        }),
      ),
    invalidate: () => Effect.void,
  });
  return { reads, resolver };
}

it.effect("keeps a reference the provider cannot read, so it never passes for an unset one", () =>
  Effect.gen(function* () {
    const { reads, resolver } = countingResolver();
    const missing = { github: { tokens: { "github.com": source("missing#token") } } };
    const resolved = yield* resolveSourceControlHostSecrets(resolver, missing, "github");
    assert.deepEqual(resolved, missing);
    assert.deepEqual(reads, ["missing#token"]);
  }),
);

it.effect("leaves the resolver unused for a kind that holds no reference", () =>
  Effect.gen(function* () {
    const { reads, resolver } = countingResolver();
    const resolved = yield* resolveSourceControlHostSecrets(resolver, hosts, "github");
    assert.strictEqual(resolved, hosts);
    assert.deepEqual(reads, []);
  }),
);

it.effect("replaces a per-host token reference and keeps the literal beside it", () =>
  Effect.gen(function* () {
    const { reads, resolver } = countingResolver();
    const resolved = yield* resolveSourceControlHostSecrets(resolver, perHostHosts, "github");
    assert.deepEqual(resolved, {
      github: { tokens: { "github.com": "ghp_from_provider", "ghe.acme.test": "ghp_literal" } },
    });
    assert.deepEqual(reads, ["github#token"]);
  }),
);

it("collects the references held in credential fields and skips literal values", () => {
  assert.deepEqual(collectSourceControlHostSecretReferences(perHostHosts), [
    source("github#token"),
  ]);
  assert.deepEqual(collectSourceControlHostSecretReferences(hosts), []);
});

it.effect("reads a collected reference again once it is invalidated", () =>
  Effect.gen(function* () {
    let current = "stale";
    const cache = new Map<string, string>();
    const resolver = SecretResolver.SecretResolver.of({
      label: (provider) => Effect.succeed(provider),
      read: (references) =>
        Effect.sync(() =>
          references.map((reference) => {
            const hit = cache.get(reference.reference);
            if (hit !== undefined) return hit;
            cache.set(reference.reference, current);
            return current;
          }),
        ),
      invalidate: (references) =>
        Effect.sync(() => {
          if (references === undefined) cache.clear();
          else for (const reference of references) cache.delete(reference.reference);
        }),
    });
    const read = () =>
      resolveSourceControlHostSecrets(resolver, perHostHosts, "github").pipe(
        Effect.map((resolved) => resolved.github?.tokens),
      );
    const usageLimitSources = {
      [UsageLimitSourceId.make("referenced")]: {
        kind: "cliproxy",
        url: "https://hub.test",
        managementKey: source("cliproxy#key"),
        enabled: true,
      },
      [UsageLimitSourceId.make("literal")]: {
        kind: "cliproxy",
        url: "https://hub.test",
        managementKey: "plain-key",
        enabled: true,
      },
    } as const;
    cache.set("cliproxy#key", "stale");
    assert.deepEqual(yield* read(), { "github.com": "stale", "ghe.acme.test": "ghp_literal" });
    current = "rotated";
    yield* invalidateSettingsSecrets(
      resolver,
      Effect.succeed({
        sourceControlHosts: perHostHosts,
        usageLimitSources,
        textGenerators: {},
      }),
    );
    assert.isFalse(cache.has("cliproxy#key"));
    assert.deepEqual(yield* read(), { "github.com": "rotated", "ghe.acme.test": "ghp_literal" });
    current = "rotated again";
    yield* invalidateSettingsSecrets(resolver, Effect.fail("settings unreadable"));
    assert.deepEqual(yield* read(), {
      "github.com": "rotated again",
      "ghe.acme.test": "ghp_literal",
    });
  }),
);
