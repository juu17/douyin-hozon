import { describe, it, expect } from "vitest";
import { launchMonkey, send, typeText, tick, lineWith, KEY, MODE_LABELS } from "./harness.js";

describe("Creator Liked Posts monkey", () => {
  it("selects the mode, exposes its parameters, accepts edits", async () => {
    const app = launchMonkey();
    try {
      await tick();

      await send(app, KEY.down, 4);      // mode index 0 → 4 (Creator Liked Posts)
      expect(app.lastFrame()).toContain("Creator Liked Posts");
      expect(app.lastFrame()).toContain("liked posts");

      for (const label of MODE_LABELS["Creator Liked Posts"]!) {
        expect(app.lastFrame()).toContain(label);
      }

      await send(app, KEY.tab);          // MODE → TASK
      await send(app, KEY.enter);        // edit Creator URL (index 0)
      await typeText(app, "mk-creator");
      await send(app, KEY.enter);
      expect(lineWith(app.lastFrame(), "Creator URL")).toContain("mk-creator");

      // Transcript (OpenAI) + Incremental Download (SQLite dedup) were both
      // cut along with their dependencies. Verify neither shows up.
      expect(app.lastFrame()).not.toContain("Generate Transcript");
      expect(app.lastFrame()).not.toContain("Transcript API Key");
      expect(app.lastFrame()).not.toContain("Incremental Download");
    } finally {
      app.cleanup();
    }
  });
});
