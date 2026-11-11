import { makeSourceControlDefinitionRegistry } from "@codenine/source-control-core/shared/definition";
import * as GitHub from "@codenine/source-control-github/shared/definition";

export const builtInSourceControlDefinitions = makeSourceControlDefinitionRegistry([
  GitHub.definition,
]);
