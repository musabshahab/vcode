import { type ChatFileAttachment } from "../../types";

export function userMessageFileLabel(file: Pick<ChatFileAttachment, "name" | "source">) {
  return file.source?._tag === "pasted-text" ? "Pasted text" : file.name;
}
