import { useCallback, useSyncExternalStore } from "react";
import { deleteDraft, readAllDrafts, writeDraft } from "./draft-storage.js";

const PERSIST_DELAY_MS = 300;

let drafts = new Map<string, string>();
let hydrated = false;
const subscribers = new Map<string, Set<() => void>>();
const persistTimers = new Map<string, ReturnType<typeof setTimeout>>();

function ensureHydrated(): void {
  if (hydrated) return;
  drafts = readAllDrafts();
  hydrated = true;
}

function notify(sessionId: string): void {
  for (const listener of subscribers.get(sessionId) ?? []) listener();
}

function schedulePersist(sessionId: string): void {
  const existing = persistTimers.get(sessionId);
  if (existing) clearTimeout(existing);
  persistTimers.set(
    sessionId,
    setTimeout(() => {
      persistTimers.delete(sessionId);
      const text = drafts.get(sessionId);
      if (text) writeDraft(sessionId, text);
      else deleteDraft(sessionId);
    }, PERSIST_DELAY_MS),
  );
}

export function getDraft(sessionId: string | undefined): string {
  if (!sessionId) return "";
  ensureHydrated();
  return drafts.get(sessionId) ?? "";
}

export function subscribeDraft(
  sessionId: string | undefined,
  listener: () => void,
): () => void {
  if (!sessionId) return () => {};
  ensureHydrated();
  const listeners = subscribers.get(sessionId) ?? new Set<() => void>();
  listeners.add(listener);
  subscribers.set(sessionId, listeners);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) subscribers.delete(sessionId);
  };
}

export function setDraft(sessionId: string | undefined, text: string): void {
  if (!sessionId) return;
  ensureHydrated();
  if ((drafts.get(sessionId) ?? "") === text) return;
  if (text) drafts.set(sessionId, text);
  else drafts.delete(sessionId);
  notify(sessionId);
  schedulePersist(sessionId);
}

export function clearDraft(sessionId: string | undefined): void {
  if (!sessionId) return;
  ensureHydrated();
  const timer = persistTimers.get(sessionId);
  if (timer) {
    clearTimeout(timer);
    persistTimers.delete(sessionId);
  }
  const changed = drafts.delete(sessionId);
  deleteDraft(sessionId);
  if (changed) notify(sessionId);
}

export function useSessionDraft(
  sessionId: string | undefined,
): readonly [string, (text: string) => void] {
  const subscribe = useCallback(
    (listener: () => void) => subscribeDraft(sessionId, listener),
    [sessionId],
  );
  const getSnapshot = useCallback(() => getDraft(sessionId), [sessionId]);
  const draft = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const update = useCallback((text: string) => setDraft(sessionId, text), [sessionId]);
  return [draft, update] as const;
}

export function __resetDraftStoreForTests(): void {
  for (const timer of persistTimers.values()) clearTimeout(timer);
  persistTimers.clear();
  subscribers.clear();
  drafts.clear();
  hydrated = false;
}
