# Releases

> For maintainers. Using Codenine? See [docs/user](../user/).

Codenine has no release pipeline yet and has published no releases. The release workflows
inherited with the code were removed because they published to accounts and signed with
credentials this project does not have. A release pipeline is future work. Until then, users run
Codenine [from source](../user/install.md).

A build checks for nothing on its own. These settings turn the update paths back on against
infrastructure you run:

- `CODENINE_DESKTOP_UPDATE_REPOSITORY` (build time): the GitHub `owner/repo` whose releases feed
  desktop auto-update. Unset, a build carries no update feed.
- `CODENINE_RELEASE_REPOSITORY`: the GitHub `owner/repo` whose releases `codenine update` lists.
- `CODENINE_RELEASE_BASE_URL`: where CLI release archives download from, laid out as GitHub release
  downloads (`<base>/v<version>/<file>`, with a `SHA256SUMS` file beside the archives).
  `codenine update`, the background service and SSH environments without `codenine` installed need
  it.
- `CODENINE_RELEASE_NPM_PACKAGE`: the npm package whose versions server update checks read.
- `CODENINE_MODEL_MANIFEST_URL`: a model manifest to refresh from. Unset, the bundled one is used.

The scripts that build release artifacts remain in the repository:
[desktop artifacts](./development.md#desktop-artifacts) through `vp run dist:desktop:*`, and the
CLI archive through [`scripts/build-cli-archive.ts`](../../scripts/build-cli-archive.ts).
