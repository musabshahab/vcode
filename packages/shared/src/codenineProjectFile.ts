import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

import { CodenineProjectFile } from "@codenine/contracts";

import { fromLenientJson } from "./schemaJson.ts";

export const CodenineProjectFileFromJson = fromLenientJson(CodenineProjectFile);

const decodeCodenineProjectFile = Schema.decodeExit(CodenineProjectFileFromJson);

export function parseCodenineProjectFile(contents: string): CodenineProjectFile | null {
  const decoded = decodeCodenineProjectFile(contents);
  return Exit.isSuccess(decoded) ? decoded.value : null;
}
