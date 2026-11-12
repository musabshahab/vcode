// Files that cannot import this hardcode the same slug: scripts/install.sh, scripts/install.ps1,
// scripts/npm-launcher/codenine.mjs, the Linux metainfo XML, apps/server/package.json, and the
// web boot shell (apps/web/src/lib/bootError.ts).
const CODENINE_REPOSITORY_SLUG = "musabshahab/codenine";
const CODENINE_RAW_MAIN_URL = `https://raw.githubusercontent.com/${CODENINE_REPOSITORY_SLUG}/main`;

export const CODENINE_REPOSITORY_URL = `https://github.com/${CODENINE_REPOSITORY_SLUG}`;
/** Codenine has no download site; the desktop app and CLI archives are release assets. */
export const CODENINE_RELEASES_URL = `${CODENINE_REPOSITORY_URL}/releases`;

export const CODENINE_INSTALL_SH_URL = `${CODENINE_RAW_MAIN_URL}/scripts/install.sh`;
export const CODENINE_INSTALL_SH_COMMAND = `curl -fsSL ${CODENINE_INSTALL_SH_URL} | sh`;
export const CODENINE_INSTALL_PS1_COMMAND = `irm ${CODENINE_RAW_MAIN_URL}/scripts/install.ps1 | iex`;

/** A page under docs/ on the default branch, such as `user/faq.md#some-heading`. */
export function codenineDocsUrl(path: string): string {
  return `${CODENINE_REPOSITORY_URL}/blob/main/docs/${path}`;
}
