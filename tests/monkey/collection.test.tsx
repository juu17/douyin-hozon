import { describe, it, expect } from "vitest";
import { launchMonkey, send, typeText, tick, lineWith, KEY, MODE_LABELS } from "./harness.js";

describe("Collection monkey", () => {
  it("selects the mode, exposes its parameters (incl. limit + dates), accepts edits", async () => {
    const app = launchMonkey();
    try {
      await tick();

      await send(app, KEY.down, 2);      // mode index 0 → 2 (Collection)
      expect(app.lastFrame()).toContain("Collection");
      expect(app.lastFrame()).toContain("collection or mix");

      for (const label of MODE_LABELS["Collection"]!) {
        expect(app.lastFrame()).toContain(label);
      }

      await send(app, KEY.tab);          // MODE → TASK
      await send(app, KEY.enter);        // edit Collection URL (index 0)
      await typeText(app, "mk-coll");
      await send(app, KEY.enter);
      expect(lineWith(app.lastFrame(), "Collection URL")).toContain("mk-coll");

      // Numeric field: Item Limit (index 2).
      await send(app, KEY.down, 2);      // index 0 → 2
      await send(app, KEY.enter);        // edit
      await typeText(app, "5");
      await send(app, KEY.enter);
      expect(lineWith(app.lastFrame(), "Item Limit")).toContain("5");

      // Checkbox: Download Cover (index 5: url,save,limit,start,end,cover).
      await send(app, KEY.down, 3);      // index 2 → 5
      expect(lineWith(app.lastFrame(), "Download Cover")).toContain("Enabled");
      await send(app, KEY.space);
      expect(lineWith(app.lastFrame(), "Download Cover")).toContain("Disabled");
    } finally {
      app.cleanup();
    }
  });
});
