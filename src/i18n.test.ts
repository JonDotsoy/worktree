import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { LOCALES, resolveLocale } from "./i18n";

const read = (name: string) => JSON.parse(readFileSync(resolve(import.meta.dir, "..", "locales", `${name}.json`), "utf8")) as Record<string, string>;

test("every locale defines the same keys", () => {
  const keys = Object.keys(read("es")).sort();
  for (const locale of LOCALES) expect(Object.keys(read(locale)).sort()).toEqual(keys);
});

test("resolveLocale honours the setting and falls back to the VS Code language", () => {
  expect(resolveLocale("en", "es")).toBe("en");
  expect(resolveLocale("es", "en")).toBe("es");
  expect(resolveLocale("auto", "es-419")).toBe("es");
  expect(resolveLocale("auto", "fr")).toBe("en");
});
