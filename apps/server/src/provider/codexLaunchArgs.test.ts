import * as NodeAssert from "node:assert/strict";

import { describe, it } from "vite-plus/test";

import {
  codexRunsOnOpenRouter,
  codexAppServerArgs,
  codexExecLaunchArgs,
} from "./codexLaunchArgs.ts";

describe("codexAppServerArgs", () => {
  it("preserves escaped TOML quotes in config values", () => {
    NodeAssert.deepStrictEqual(
      codexAppServerArgs(String.raw`--config model=\"gpt-6.1-sol\" --strict-config`),
      ["app-server", "--config", 'model="gpt-6.1-sol"', "--strict-config"],
    );
  });
});

describe("codexExecLaunchArgs", () => {
  it("keeps shared codex flags and omits app-server-only flags", () => {
    NodeAssert.deepStrictEqual(
      codexExecLaunchArgs('--strict-config --enable foo --listen off --config model="gpt 5"'),
      ["--strict-config", "--enable", "foo", "--config", "model=gpt 5"],
    );
  });

  it("does not pair value-taking flags with adjacent flags", () => {
    NodeAssert.deepStrictEqual(codexExecLaunchArgs("--config --strict-config --enable --disable"), [
      "--strict-config",
    ]);
  });
});

describe("codexRunsOnOpenRouter", () => {
  it.each([
    ["-c model_provider=openrouter -c model_providers.openrouter.wire_api=responses", true],
    ['--config model_provider="openrouter"', true],
    ["-c=model_provider=openrouter", true],
    ["-c model_provider=azure", false],
    // Defining the provider is not selecting it.
    ["-c model_providers.openrouter.name=OpenRouter", false],
    ["", false],
  ])("reads the selected model provider from %s", (launchArgs, expected) => {
    NodeAssert.equal(codexRunsOnOpenRouter(launchArgs), expected);
  });
});
