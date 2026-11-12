import type { EnvironmentId } from "@codenine/contracts";

import { ensureClientSettingsHydrated, persistClientSettingsUpdate } from "../hooks/useSettings";

export async function completeOnboarding(
  primaryEnvironmentId: EnvironmentId | null,
): Promise<void> {
  await ensureClientSettingsHydrated();
  const onboardingCompletedAt = new Date().toISOString();
  await persistClientSettingsUpdate((current) => ({
    ...current,
    onboardingCompletedAt,
    onboardingCompletedEnvironmentId: primaryEnvironmentId,
  }));
}
