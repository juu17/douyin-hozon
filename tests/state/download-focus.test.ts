import { describe, it, expect } from "vitest";
import { reducer, INITIAL_STATE, type AppState } from "../../src/state/store.js";

// Requirement: when a download finishes or fails, the cursor returns from the
// Download button to the mode's URL field (row 0) so the user can paste the
// next link. use-downloader dispatches SET_DOWNLOAD_ACTIVE {active:false} in
// its finally block (the finish/fail path), so the focus reset lives in the
// reducer for that action.
describe("download end returns focus to the URL field", () => {
  const onDownloadButton: AppState = {
    ...INITIAL_STATE,
    panelFocus: "task",
    taskIndex: 5, // somewhere other than the URL field (e.g. the Download row)
    downloadActive: true,
  };

  it("resets taskIndex to the URL field (row 0) when a download ends", () => {
    const next = reducer(onDownloadButton, { type: "SET_DOWNLOAD_ACTIVE", active: false });
    expect(next.downloadActive).toBe(false);
    expect(next.taskIndex).toBe(0);
  });

  it("leaves taskIndex untouched when a download STARTS", () => {
    const next = reducer(
      { ...INITIAL_STATE, taskIndex: 5 },
      { type: "SET_DOWNLOAD_ACTIVE", active: true },
    );
    expect(next.downloadActive).toBe(true);
    expect(next.taskIndex).toBe(5);
  });
});
