/**
 * Ensemble's feature set. A hidden feature keeps its code, so the upstream project's updates still
 * apply; it only loses its entry points. Remove a name here to bring that feature back.
 */
const HIDDEN_FEATURES = [
  // These point at the upstream project's repository, policies or store listings. Its hosted
  // sign-in and tunnel need no entry: they stay off unless a build is given their keys.
  "upstreamPrompts",
  "mobileApp",
  // Not part of running a team.
  "voice",
  "snapShot",
  "devices",
  "secrets",
  "labs",
  "linkedEnvironments",
  "otherSourceControlHosts",
] as const;

export type EditionFeature = (typeof HIDDEN_FEATURES)[number];

const hidden: ReadonlySet<string> = new Set(HIDDEN_FEATURES);

export const isFeatureHidden = (feature: EditionFeature) => hidden.has(feature);

const SETTINGS_PAGE_FEATURES: Readonly<Record<string, EditionFeature>> = {
  "/settings/voice": "voice",
  "/settings/snap-shot": "snapShot",
  "/settings/devices": "devices",
  "/settings/secrets": "secrets",
  "/settings/labs": "labs",
};

const SETTINGS_ROW_FEATURES: Readonly<Record<string, EditionFeature>> = {
  "mobile-app": "mobileApp",
  "privacy-policy": "upstreamPrompts",
};

/** Whether a settings page, by its path, belongs to a hidden feature. */
export const isSettingsPageHidden = (path: string) => {
  const feature = SETTINGS_PAGE_FEATURES[path];
  return feature !== undefined && isFeatureHidden(feature);
};

/** Whether a settings row, by its search id, belongs to a hidden feature. */
export const isSettingsRowHidden = (id: string) => {
  const feature = SETTINGS_ROW_FEATURES[id];
  return feature !== undefined && isFeatureHidden(feature);
};
