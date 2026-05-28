import { describe, it, expect } from "vitest";
import { launchMonkey, send, typeText, tick, lineWith, KEY, MODE_LABELS } from "./harness.js";

describe("My Favorite Collection monkey", () => {
  it("selects the mode, shows readonly source, exposes its parameters, accepts edits", async () => {
    const app = launchMonkey();
    try {
      await tick();

      await send(app, KEY.down, 5);      // mode index 0 → 5 (My Favorite Collection)
      expect(app.lastFrame()).toContain("My Favorite Collection");
      expect(app.lastFrame()).toContain("favorite collection");

      for (const label of MODE_LABELS["My Favorite Collection"]!) {
        expect(app.lastFrame()).toContain(label);
      }

      await send(app, KEY.tab);          // MODE → TASK (index 0 = Favorite Source, readonly)
      // Readonly source is pre-filled with the logged-in favorites URL.
      expect(lineWith(app.lastFrame(), "Favorite Source")).toContain("https");

      // Numeric field: Item Limit (index 2: source, save, limit).
      await send(app, KEY.down, 2);
      await send(app, KEY.enter);
      await typeText(app, "3");
      await send(app, KEY.enter);
      expect(lineWith(app.lastFrame(), "Item Limit")).toContain("3");

      // Checkbox: Download Cover (index 3).
      await send(app, KEY.down, 1);      // index 2 → 3
      expect(lineWith(app.lastFrame(), "Download Cover")).toContain("Enabled");
      await send(app, KEY.space);
      expect(lineWith(app.lastFrame(), "Download Cover")).toContain("Disabled");
    } finally {
      app.cleanup();
    }
  });
});
