import { SecretProviderId, SecretProviderKind } from "@codenine/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render, type Screen } from "../../../test/render";
import { SecretSourceInput } from "./SecretSourceInput";

const personal = SecretProviderId.make("personal");
const work = SecretProviderId.make("work");
const sources = [
  { id: personal, kind: SecretProviderKind.make("vault"), label: "Personal" },
  { id: work, kind: SecretProviderKind.make("vault"), label: "Work" },
];

const reference = (screen: Screen) => screen.getByRole("textbox", { name: "API key reference" });

async function commitReference(screen: Screen, value: string) {
  await userEvent.clear(reference(screen));
  await userEvent.type(reference(screen), value);
  await userEvent.keyboard("{Enter}");
}

describe("SecretSourceInput", () => {
  it("moves a reference to another provider only once one is committed for it", async () => {
    const onSecretChange = vi.fn();
    const onValidityChange = vi.fn();
    await using screen = await render(
      <SecretSourceInput
        aria-label="API key"
        value={{ provider: personal, reference: "op://Private/OpenAI/credential" }}
        sources={sources}
        onCommit={() => {}}
        onSecretChange={onSecretChange}
        onValidityChange={onValidityChange}
      />,
    );

    await userEvent.click(screen.getByRole("combobox", { name: "API key source" }));
    await userEvent.click(screen.getByRole("option", { name: "Work" }));
    expect(onSecretChange).not.toHaveBeenCalled();
    expect(onValidityChange).toHaveBeenLastCalledWith(false);
    await expect.element(reference(screen)).toHaveValue("");

    await commitReference(screen, "op://Shared/OpenAI/credential");
    expect(onSecretChange).toHaveBeenCalledExactlyOnceWith({
      provider: work,
      reference: "op://Shared/OpenAI/credential",
    });
    expect(onValidityChange).toHaveBeenLastCalledWith(true);
  });

  it("removes the reference when its field is cleared", async () => {
    const onSecretChange = vi.fn();
    await using screen = await render(
      <SecretSourceInput
        aria-label="API key"
        value={{ provider: personal, reference: "op://Private/OpenAI/credential" }}
        sources={sources}
        onCommit={() => {}}
        onSecretChange={onSecretChange}
      />,
    );

    await userEvent.clear(reference(screen));
    await userEvent.keyboard("{Enter}");
    expect(onSecretChange).toHaveBeenCalledExactlyOnceWith(undefined);
  });
});
