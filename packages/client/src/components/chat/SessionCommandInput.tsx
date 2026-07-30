import { CommandInput, type CommandInputProps } from "./CommandInput.js";
import { useSessionDraft } from "../../lib/state/draft-store.js";

export type SessionCommandInputProps = Omit<
  CommandInputProps,
  "draft" | "onDraftChange" | "sessionId"
> & { sessionId: string };

export function SessionCommandInput(props: SessionCommandInputProps) {
  const [draft, onDraftChange] = useSessionDraft(props.sessionId);
  return (
    <CommandInput
      {...props}
      draft={draft}
      onDraftChange={onDraftChange}
    />
  );
}
