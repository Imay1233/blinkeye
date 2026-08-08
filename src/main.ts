import "./styles.css";

import { getCurrentWindow } from "@tauri-apps/api/window";

const appWindow = getCurrentWindow();

window.addEventListener("DOMContentLoaded", () => {
  const widget = document.getElementById("widget");
  const eye = document.getElementById("eye") as HTMLImageElement;

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
});