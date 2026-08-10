import "./styles.css";

import { getCurrentWindow } from "@tauri-apps/api/window";

const appWindow = getCurrentWindow();

window.addEventListener("DOMContentLoaded", () => {
  const widget = document.getElementById("widget");
  const hoverArea = document.getElementById("hover-area");
  const eye = document.getElementById("eye") as HTMLImageElement;

  let isHovered = false;
  let isWiggling = false;

  /*
  DRAGGING
  */

  widget?.addEventListener("mousedown", async (event) => {
    if (event.button === 0) {
      await appWindow.startDragging();
    }
  });

  /*
  DISABLE RIGHT-CLICK MENU
  */

  document.addEventListener("contextmenu", (event) => {
    event.preventDefault();
  });

  /*
  BLINKING
  */

  async function blink() {
    eye.src = "/src/assets/eye-closed.svg";

    await new Promise((resolve) => {
      setTimeout(resolve, 160);
    });

    eye.src = "/src/assets/eye-open.svg";
  }

  function randomDelay(min: number, max: number) {
    return Math.floor(
      Math.random() * (max - min + 1) + min
    );
  }

  async function blinkLoop() {
    while (true) {
      /*
        Wait a random amount of time before blinking.

        For now:
        3 to 8 seconds.
      */

      const delay = randomDelay(3000, 8000);

      await new Promise((resolve) => {
        setTimeout(resolve, delay);
      });

      /*
        Normal blink.
      */

      await blink();

      /*
        Occasionally perform a second blink shortly afterward.

        20% chance for now.
      */

      if (Math.random() < 0.2) {
        await new Promise((resolve) => {
          setTimeout(resolve, randomDelay(250, 500));
        });

        await blink();
      }
    }
  }

  blinkLoop();

  /*
  HOVER
  */

  hoverArea?.addEventListener("mouseenter", () => {
    isHovered = true;

    /*
      If the wiggle is currently happening,
      stop it immediately.
    */

    if (isWiggling) {
      hoverArea.classList.remove("wiggle");
      isWiggling = false;
    }
  });

  hoverArea?.addEventListener("mouseleave", () => {
    isHovered = false;
  });

  /*
  WIGGLE
  */

  const WIGGLE_INTERVAL = 10_000; // 10 seconds for testing

  setInterval(() => {
    /*
      Don't wiggle while the user is hovering.
      Don't start another wiggle if one is already running.
    */

    if (isHovered || isWiggling) {
      return;
    }

    isWiggling = true;

    hoverArea?.classList.add("wiggle");
  }, WIGGLE_INTERVAL);

  /*
  When the CSS animation finishes,
  clean up the class and allow another wiggle.
  */

  hoverArea?.addEventListener("animationend", () => {
    hoverArea.classList.remove("wiggle");
    isWiggling = false;
  });
});