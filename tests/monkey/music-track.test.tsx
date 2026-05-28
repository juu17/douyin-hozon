import { describe, it, expect } from "vitest";
import { launchMonkey, send, typeText, tick, lineWith, KEY, MODE_LABELS } from "./harness.js";

describe("Music Track monkey", () => {
  it("selects the mode, exposes its parameters, omits Download Music, accepts edits", async () => {
    const app = launchMonkey();
    try {
      await tick();

      await send(app, KEY.down, 3);      // mode index 0 → 3 (Music Track)
      expect(app.lastFrame()).toContain("Music Track");
      expect(app.lastFrame()).toContain("music track");

      for (const label of MODE_LABELS["Music Track"]!) {
        expect(app.lastFrame()).toContain(label);
      }
      // The item IS music, so there's no "Download Music" checkbox here.
      expect(app.lastFrame()).not.toContain("Download Music");

      await send(app, KEY.tab);          // MODE → TASK
      await send(app, KEY.enter);        // edit Music URL (index 0)
      await typeText(app, "mk-music");
      await send(app, KEY.enter);
      expect(lineWith(app.lastFrame(), "Music URL")).toContain("mk-music");

      // Checkbox: Download Cover (index 2: url, save, cover).
      await send(app, KEY.down, 2);
      expect(lineWith(app.lastFrame(), "Download Cover")).toContain("Enabled");
      await send(app, KEY.space);
      expect(lineWith(app.lastFrame(), "Download Cover")).toContain("Disabled");
    } finally {
      app.cleanup();
    }
  });
});
