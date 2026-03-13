import { describe, expect, it } from "vitest";

import {
  applyThemePreference,
  getSystemPrefersDark,
  readStoredThemePreference,
  resolveThemePreference,
  THEME_COLOR_BY_MODE,
  THEME_MEDIA_QUERY,
  THEME_STORAGE_KEY,
} from "@/lib/theme";

describe("theme", () => {
  it("falls back to system when the stored value is invalid", () => {
    const storage = {
      getItem: () => "sepia",
    } satisfies Pick<Storage, "getItem">;

    expect(readStoredThemePreference(storage)).toBe("system");
  });

  it("resolves system preference from the current media query", () => {
    expect(resolveThemePreference("system", false)).toBe("light");
    expect(resolveThemePreference("system", true)).toBe("dark");
    expect(resolveThemePreference("dark", false)).toBe("dark");
  });

  it("reads the system color scheme from matchMedia", () => {
    const windowObject = {
      matchMedia: (query: string) => ({
        matches: query === THEME_MEDIA_QUERY,
      }),
    } as Pick<Window, "matchMedia">;

    expect(getSystemPrefersDark(windowObject)).toBe(true);
  });

  it("applies the resolved theme to the root element and theme-color meta tag", () => {
    const rootElement = document.documentElement;
    const themeColorMeta = document.createElement("meta");
    themeColorMeta.name = "theme-color";
    document.head.appendChild(themeColorMeta);

    applyThemePreference(rootElement, "dark", false);

    expect(rootElement.classList.contains("dark")).toBe(true);
    expect(rootElement.style.colorScheme).toBe("dark");
    expect(themeColorMeta.content).toBe(THEME_COLOR_BY_MODE.dark);

    applyThemePreference(rootElement, "light", true);

    expect(rootElement.classList.contains("dark")).toBe(false);
    expect(rootElement.style.colorScheme).toBe("light");
    expect(themeColorMeta.content).toBe(THEME_COLOR_BY_MODE.light);

    themeColorMeta.remove();
  });

  it("reads the stored preference when present", () => {
    const storage = {
      getItem: (key: string) => (key === THEME_STORAGE_KEY ? "dark" : null),
    } satisfies Pick<Storage, "getItem">;

    expect(readStoredThemePreference(storage)).toBe("dark");
  });
});
