import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const LOCALES = ["es", "en"] as const;
export type Locale = (typeof LOCALES)[number];

/** Resolves the `worktree.locale` setting (`auto`, `es`, `en`) against VS Code's display language. */
export function resolveLocale(setting: unknown, vscodeLanguage: string): Locale {
  if (setting === "es" || setting === "en") return setting;
  return vscodeLanguage.toLowerCase().startsWith("es") ? "es" : "en";
}

/** Reads `<dir>/<locale>.json`, falling back to Spanish keys that the locale lacks. */
export async function loadLocale(dir: string, locale: Locale): Promise<Record<string, string>> {
  const read = async (name: string) => JSON.parse(await readFile(join(dir, `${name}.json`), "utf8")) as Record<string, string>;
  const base = await read("es");
  return locale === "es" ? base : { ...base, ...(await read(locale)) };
}
