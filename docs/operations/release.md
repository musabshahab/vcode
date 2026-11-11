# Releases

> For maintainers. Using T3 Code? See [docs/user](../user/).

This fork has no release pipeline yet. The upstream release workflows published to T3's GitHub
releases, npm package, Vercel projects and Discord, and needed T3's signing and deploy secrets, so
they were removed. A release pipeline of our own is future work.

Builds check for nothing on their own. These settings turn the update paths back on against
infrastructure you run:

- `T3CODE_DESKTOP_UPDATE_REPOSITORY` (build time): the GitHub `owner/repo` whose releases feed
  desktop auto-update. Unset, a build carries no update feed.
- `T3CODE_RELEASE_REPOSITORY`: the GitHub `owner/repo` whose releases `t3 update` lists.
- `T3CODE_RELEASE_BASE_URL`: where CLI release archives download from, laid out as GitHub release
  downloads. Self-update, the boot service and SSH environments without `t3` installed need it.
- `T3CODE_RELEASE_NPM_PACKAGE`: the npm package whose versions server update checks read.
- `T3CODE_MODEL_MANIFEST_URL`: a model manifest to refresh from. Unset, the bundled one is used.
