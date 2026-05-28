import { describe, it, expect } from "vitest";
import { launchMonkey, send, typeText, tick, lineWith, KEY, MODE_LABELS } from "./harness.js";

describe("Image Note monkey", () => {
  it("selects the mode, exposes its parameters, accepts edits", async () => {
    const app = launchMonkey();
    try {
      await tick();

      await send(app, KEY.down, 1);      // mode index 0 → 1 (Image Note)
      expect(app.lastFrame()).toContain("Image Note");
      expect(app.lastFrame()).toContain("image note");

      for (const label of MODE_LABELS["Image Note"]!) {
        expect(app.lastFrame()).toContain(label);
      }
      // Image Note has no transcript field.
      expect(app.lastFrame()).not.toContain("Generate Transcript");

      await send(app, KEY.tab);          // MODE → TASK
      await send(app, KEY.enter);        // edit Note URL (index 0)
      await typeText(app, "mk-note");
      await send(app, KEY.enter);
      expect(lineWith(app.lastFrame(), "Note URL")).toContain("mk-note");

      await send(app, KEY.down, 2);      // index 0 → 2 (Download Cover)
      expect(lineWith(app.lastFrame(), "Download Cover")).toContain("Enabled");
      await send(app, KEY.space);
      expect(lineWith(app.lastFrame(), "Download Cover")).toContain("Disabled");
    } finally {
      app.cleanup();
    }
  });
});
