import "./styles.css";

import {
  getCurrentWindow,
  currentMonitor,
} from "@tauri-apps/api/window";

import { PhysicalPosition } from "@tauri-apps/api/dpi";

const appWindow = getCurrentWindow();

window.addEventListener("DOMContentLoaded", async () => {
  /*
  Get the monitor where the widget is located.
  */

  const monitor = await currentMonitor();

  const width = monitor?.size.width || 0;
  const height = monitor?.size.height || 0;

  /*
  Center the widget on the screen.
  */

  await appWindow.setPosition(
    new PhysicalPosition(width / 2 - 50, height / 2 - 50)
  );

  const widget = document.getElementById("widget");
  const hoverArea = document.getElementById("hover-area");
  const eye = document.getElementById("eye") as HTMLImageElement;

  let isHovered = false;
  let isWiggling = false;

  /*
  Keep app on screen
  */

  async function keepWindowOnScreen() {
    const monitor = await currentMonitor();

    if (!monitor) {
      return;
    }

    const position = await appWindow.outerPosition();
    const size = await appWindow.outerSize();

    const workArea = monitor.workArea;

    const minX = workArea.position.x;
    const minY = workArea.position.y;

    const maxX =
      workArea.position.x +
      workArea.size.width -
      size.width;

    const maxY =
      workArea.position.y +
      workArea.size.height -
      size.height;

    const newX = Math.max(minX, Math.min(position.x, maxX));
    const newY = Math.max(minY, Math.min(position.y, maxY));

    if (newX !== position.x || newY !== position.y) {
      await appWindow.setPosition(
        new PhysicalPosition(newX, newY)
      );
    }
  }

  let moveTimer: ReturnType<typeof setTimeout> | null = null;

  appWindow.onMoved(() => {
    if (moveTimer) {
      clearTimeout(moveTimer);
    }

    moveTimer = setTimeout(async () => {
      await keepWindowOnScreen();
    }, 150);
  });



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