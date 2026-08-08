import "./styles.css";

import { getCurrentWindow } from "@tauri-apps/api/window";
import { PhysicalPosition } from "@tauri-apps/api/dpi";

const appWindow = getCurrentWindow();

window.addEventListener("DOMContentLoaded", () => {
  const widget = document.getElementById("widget");
  const hoverArea = document.getElementById("hover-area");
  const eye = document.getElementById("eye") as HTMLImageElement;

  let isHovered = false;
  let isWiggling = false;

  let wiggleStartPosition: PhysicalPosition | null = null;

  // -------------------------
  // Drag window
  // -------------------------

  widget?.addEventListener("mousedown", async (e) => {
    if (e.button === 0) {
      await appWindow.startDragging();
    }
  });

  // -------------------------
  // Blink
  // -------------------------

  async function blink() {
    eye.src = "/src/assets/eye-closed.svg";

    await new Promise((resolve) => setTimeout(resolve, 160));

    eye.src = "/src/assets/eye-open.svg";
  }

  setInterval(blink, 4000);

  // -------------------------
  // Hover
  // -------------------------

  hoverArea?.addEventListener("mouseenter", async () => {
    isHovered = true;

    // If we're currently wiggling,
    // immediately restore the original position.
    if (isWiggling && wiggleStartPosition) {
      await appWindow.setPosition(
        new PhysicalPosition(
          wiggleStartPosition.x,
          wiggleStartPosition.y
        )
      );
    }
  });

  hoverArea?.addEventListener("mouseleave", () => {
    isHovered = false;
  });

  // -------------------------
  // Wiggle
  // -------------------------

  const WIGGLE_INTERVAL = 10_000; // 10 seconds for testing
  const STEP_TIME = 200;          // 200 ms per movement
  const WIGGLE_AMOUNT = 9;        // maximum movement in pixels

  async function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function wiggle() {
    if (isHovered || isWiggling) {
      return;
    }

    isWiggling = true;

    try {
      // Remember the exact position before moving.
      wiggleStartPosition = await appWindow.outerPosition();

      const offsets = [
        0,
        WIGGLE_AMOUNT,
        -WIGGLE_AMOUNT,
        6,
        -6,
        3,
        -3,
        0
      ];

      for (const offset of offsets) {
        if (isHovered) {
          break;
        }

        await appWindow.setPosition(
          new PhysicalPosition(
            wiggleStartPosition.x,
            wiggleStartPosition.y + offset
          )
        );

        await sleep(STEP_TIME);
      }

      // Always return to exactly where we started.
      await appWindow.setPosition(
        new PhysicalPosition(
          wiggleStartPosition.x,
          wiggleStartPosition.y
        )
      );

    } catch (error) {
      console.error("Wiggle failed:", error);
    }

    wiggleStartPosition = null;
    isWiggling = false;
  }

  // Test: wiggle approximately every 10 seconds.
  setInterval(wiggle, WIGGLE_INTERVAL);
});