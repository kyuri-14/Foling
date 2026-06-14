// Tiny i18n layer. The SOURCE language is English: every UI string is written
// in English and passed through `t()`. A locale pack is a dictionary mapping
// the English source string → its translation. English is the default (no
// pack → `t()` returns the key as-is). The Japanese pack (locales/ja.ts) is
// the "Japanese localization" the user asked to keep as a switchable pack.

import { useSyncExternalStore } from "react";

export type LocaleDict = Record<string, string>;

let dict: LocaleDict = {};
let version = 0;
const listeners = new Set<() => void>();

/** Translate an English source string via the active locale pack. */
export function t(en: string): string {
  return dict[en] ?? en;
}

/** Swap the active locale pack (empty = English). Re-renders subscribers. */
export function setLocaleDict(d: LocaleDict | null) {
  dict = d ?? {};
  version++;
  listeners.forEach((l) => l());
}

/** Subscribe a component to locale changes so `t()` output stays current. */
export function useLocaleVersion(): number {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => version,
    () => version
  );
}
