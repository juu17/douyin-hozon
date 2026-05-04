#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import { App } from "./app.js";
import { StoreProvider } from "./state/store.js";

const ALT_SCREEN_ENTER = "\x1b[?1049h";
const ALT_SCREEN_LEAVE = "\x1b[?1049l";

function enterAltScreen(): void {
  if (process.stdout.isTTY) process.stdout.write(ALT_SCREEN_ENTER);
}

function leaveAltScreen(): void {
  if (process.stdout.isTTY) process.stdout.write(ALT_SCREEN_LEAVE);
}

enterAltScreen();
const instance = render(
  <StoreProvider>
    <App />
  </StoreProvider>,
  { patchConsole: false },
);

const cleanup = (): void => {
  leaveAltScreen();
};

instance.waitUntilExit().then(cleanup, cleanup);
process.on("exit", cleanup);
process.on("SIGINT", () => {
  instance.unmount();
});
process.on("SIGTERM", () => {
  instance.unmount();
});
