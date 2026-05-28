import { describe, it, expect } from "vitest";
import { launchMonkey, send, typeText, tick, lineWith, KEY, MODE_LABELS } from "./harness.js";

describe("Single Video monkey", () => {
  it("selects the mode, exposes its parameters, accepts edits", async () => {
    const app = launchMonkey();
    try {
      await tick();

      // Mode is index 0 — selected on launch. TASK shows its identity.
      expect(app.lastFrame()).toContain("Single Video");
      expect(app.lastFrame()).toContain("Download one Douyin video");

      // Every parameter this mode accepts is rendered.
      for (const label of MODE_LABELS["Single Video"]!) {
        expect(app.lastFrame()).toContain(label);
      }

      // Edit the URL field (index 0): focus TASK, open editor, type, commit.
      await send(app, KEY.tab);          // MODE → TASK
      await send(app, KEY.enter);        // edit Video URL
      await typeText(app, "mk-video");
      await send(app, KEY.enter);        // commit
      expect(lineWith(app.lastFrame(), "Video URL")).toContain("mk-video");

      // Toggle a checkbox (Download Cover, index 2) and confirm it flips.
      await send(app, KEY.down, 2);      // index 0 → 2
      expect(lineWith(app.lastFrame(), "Download Cover")).toContain("Enabled");
      await send(app, KEY.space);
      expect(lineWith(app.lastFrame(), "Download Cover")).toContain("Disabled");

      // Transcript was an OpenAI-Whisper integration; cut. Verify it's gone.
      expect(app.lastFrame()).not.toContain("Generate Transcript");
      expect(app.lastFrame()).not.toContain("Transcript API Key");
    } finally {
      app.cleanup();
    }
  });
});
