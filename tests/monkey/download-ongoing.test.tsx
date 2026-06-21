import { describe, it, expect } from "vitest";
import { launchMonkey, send, tick, KEY } from "./harness.js";

// Requirement: while a download is ongoing and focus is in the TASK panel, the
// Download button shows an "ongoing" status and Enter can't re-trigger it (no
// duplicate run, no "already running" alert).
describe("ongoing download monkey", () => {
  it("shows Downloading… and ignores Enter on the Download button", async () => {
    const app = launchMonkey({ downloadActive: true });
    try {
      await tick();

      // The button reflects the ongoing status instead of the idle label.
      expect(app.lastFrame()).toContain("Downloading…");

      // Focus TASK, then move to the Download row.
      await send(app, KEY.tab); // MODE → TASK
      await send(app, KEY.tab); // fields → Download row

      // Enter on the Download row must be inert: no launch, no "in progress" alert.
      await send(app, KEY.enter);
      expect(app.lastFrame()).not.toContain("already running");
      expect(app.lastFrame()).not.toContain("Download In Progress");
      // Still ongoing, button unchanged.
      expect(app.lastFrame()).toContain("Downloading…");
    } finally {
      app.cleanup();
    }
  });
});
