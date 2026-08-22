import "./styles.css";

import { invoke } from "@tauri-apps/api/core";
import {
  getCurrentWindow,
  currentMonitor,
} from "@tauri-apps/api/window";

import { PhysicalPosition, LogicalSize } from "@tauri-apps/api/dpi";

const appWindow = getCurrentWindow();

interface AppSettings {
  eyeColor: string;
  outlineColor: string;
  outlineEnabled: boolean;
  matchOutlineColor: boolean;
  wiggleEnabled: boolean;
  blinkSpeed: "relaxed" | "normal" | "active";
  scale: number;
}

const DEFAULT_SETTINGS: AppSettings = {
  eyeColor: "#ffffff",
  outlineColor: "#2f2f2f",
  outlineEnabled: true,
  matchOutlineColor: false,
  wiggleEnabled: true,
  blinkSpeed: "normal",
  scale: 1.0,
};

function loadSettings(): AppSettings {
  try {
    const saved = localStorage.getItem("blinkeye_settings");
    if (saved) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
    }
  } catch (e) {
    console.error("Failed to load settings from localStorage", e);
  }
  return { ...DEFAULT_SETTINGS };
}

function saveSettings(settings: AppSettings) {
  try {
    localStorage.setItem("blinkeye_settings", JSON.stringify(settings));
  } catch (e) {
    console.error("Failed to save settings to localStorage", e);
  }
}

window.addEventListener("DOMContentLoaded", async () => {
  let settings: AppSettings = loadSettings();

  /*
  Get the monitor where the widget is located.
  */

  const monitor = await currentMonitor();
  const screenWidth = monitor?.size.width || 0;
  const screenHeight = monitor?.size.height || 0;

  /*
  Center the widget on the screen.
  */

  await appWindow.setPosition(
    new PhysicalPosition(screenWidth / 2 - 130, screenHeight / 2 - 130)
  );

  const widget = document.getElementById("widget");
  const hoverArea = document.getElementById("hover-area");
  const settingsToggle = document.getElementById("settings-toggle");

  // Setting Elements
  const eyeColorGroup = document.getElementById("eye-color-group");
  const eyeCustomColor = document.getElementById("eye-custom-color") as HTMLInputElement;
  const eyeCustomIndicator = document.getElementById("eye-custom-indicator");

  const outlineToggle = document.getElementById("outline-toggle") as HTMLInputElement;
  const matchOutlineToggle = document.getElementById("match-outline-toggle") as HTMLInputElement;
  const outlineColorRow = document.getElementById("outline-color-row");
  const outlineColorGroup = document.getElementById("outline-color-group");
  const outlineCustomColor = document.getElementById("outline-custom-color") as HTMLInputElement;
  const outlineCustomIndicator = document.getElementById("outline-custom-indicator");

  const wiggleToggle = document.getElementById("wiggle-toggle") as HTMLInputElement;
  const blinkSpeedControl = document.getElementById("blink-speed-control");
  const scaleControl = document.getElementById("scale-control");
  const scaleValLabel = document.getElementById("scale-val-label");
  const resetSettingsBtn = document.getElementById("reset-settings-btn");

  let isHovered = false;
  let isWiggling = false;
  let isSettingsOpen = false;

  function getWindowSizes(scale: number) {
    const BASE_CARD = 260;
    const normalWidth = Math.round(BASE_CARD * scale);
    const normalHeight = Math.round(BASE_CARD * scale);

    const SETTINGS_PANEL_WIDTH = 380;
    const expandedWidth = Math.round((BASE_CARD * scale) + SETTINGS_PANEL_WIDTH);
    const expandedHeight = Math.max(normalHeight, 350);

    return { normalWidth, normalHeight, expandedWidth, expandedHeight };
  }

  async function updateWindowSize() {
    const sizes = getWindowSizes(settings.scale);
    if (isSettingsOpen) {
      await appWindow.setSize(new LogicalSize(sizes.expandedWidth, sizes.expandedHeight));
    } else {
      await appWindow.setSize(new LogicalSize(sizes.normalWidth, sizes.normalHeight));
    }
    await keepWindowOnScreen();
  }

  function applySettingsToDOM(updateUI: boolean = true) {
    const root = document.documentElement;

    const activeOutlineColor = settings.matchOutlineColor
      ? settings.eyeColor
      : settings.outlineColor;

    root.style.setProperty("--eye-color", settings.eyeColor);
    root.style.setProperty("--eye-outline-color", activeOutlineColor);
    root.style.setProperty(
      "--eye-outline-width",
      settings.outlineEnabled ? "4px" : "0px"
    );
    root.style.setProperty("--eye-scale", settings.scale.toString());

    if (eyeCustomIndicator) {
      eyeCustomIndicator.style.backgroundColor = settings.eyeColor;
    }
    if (outlineCustomIndicator) {
      outlineCustomIndicator.style.backgroundColor = activeOutlineColor;
    }

    if (!updateUI) return;

    // 1. Eye color swatches
    eyeColorGroup?.querySelectorAll(".color-swatch").forEach((btn) => {
      const color = (btn as HTMLElement).dataset.color;
      if (color?.toLowerCase() === settings.eyeColor.toLowerCase()) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    });

    const eyeCustomBtn = eyeCustomColor?.closest(".custom-color-btn");
    const eyeMatchesPreset = Array.from(
      eyeColorGroup?.querySelectorAll(".color-swatch") || []
    ).some(
      (b) => (b as HTMLElement).dataset.color?.toLowerCase() === settings.eyeColor.toLowerCase()
    );
    if (!eyeMatchesPreset && eyeCustomBtn) {
      eyeCustomBtn.classList.add("active");
    } else if (eyeCustomBtn) {
      eyeCustomBtn.classList.remove("active");
    }
    if (eyeCustomColor) {
      eyeCustomColor.value = settings.eyeColor;
    }

    // 2. Outline controls
    if (outlineToggle) {
      outlineToggle.checked = settings.outlineEnabled;
    }
    if (matchOutlineToggle) {
      matchOutlineToggle.checked = settings.matchOutlineColor;
    }

    if (outlineColorRow) {
      if (!settings.outlineEnabled || settings.matchOutlineColor) {
        outlineColorRow.classList.add("disabled");
      } else {
        outlineColorRow.classList.remove("disabled");
      }
    }

    // 3. Outline color swatches
    outlineColorGroup?.querySelectorAll(".color-swatch").forEach((btn) => {
      const color = (btn as HTMLElement).dataset.color;
      if (color?.toLowerCase() === settings.outlineColor.toLowerCase()) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    });

    const outlineCustomBtn = outlineCustomColor?.closest(".custom-color-btn");
    const outlineMatchesPreset = Array.from(
      outlineColorGroup?.querySelectorAll(".color-swatch") || []
    ).some(
      (b) => (b as HTMLElement).dataset.color?.toLowerCase() === settings.outlineColor.toLowerCase()
    );
    if (!outlineMatchesPreset && outlineCustomBtn) {
      outlineCustomBtn.classList.add("active");
    } else if (outlineCustomBtn) {
      outlineCustomBtn.classList.remove("active");
    }
    if (outlineCustomColor) {
      outlineCustomColor.value = settings.outlineColor;
    }

    // 4. Wiggle toggle
    if (wiggleToggle) {
      wiggleToggle.checked = settings.wiggleEnabled;
    }

    // 5. Blink speed segments
    blinkSpeedControl?.querySelectorAll(".segment-btn").forEach((btn) => {
      const speed = (btn as HTMLElement).dataset.speed;
      if (speed === settings.blinkSpeed) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    });

    // 6. Scale control
    scaleControl?.querySelectorAll(".segment-btn").forEach((btn) => {
      const s = parseFloat((btn as HTMLElement).dataset.scale || "1.0");
      if (s === settings.scale) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    });

    if (scaleValLabel) {
      scaleValLabel.textContent = `${settings.scale}x`;
    }
  }

  // Initial apply
  applySettingsToDOM(true);
  await updateWindowSize();

  /*
  SETTINGS TOGGLE
  */

  async function toggleSettings() {
    if (isSettingsOpen) {
      isSettingsOpen = false;
      widget?.classList.remove("settings-open");

      setTimeout(async () => {
        if (!isSettingsOpen) {
          await updateWindowSize();
        }
      }, 280);
    } else {
      isSettingsOpen = true;

      if (isWiggling && hoverArea) {
        hoverArea.classList.remove("wiggle");
        isWiggling = false;
      }

      await updateWindowSize();
      widget?.classList.add("settings-open");
    }
  }

  settingsToggle?.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleSettings();
  });

  /*
  SETTINGS EVENTS
  */

  // Eye color presets
  eyeColorGroup?.addEventListener("click", (e) => {
    const target = (e.target as HTMLElement).closest(".color-swatch") as HTMLElement;
    if (target && target.dataset.color) {
      settings.eyeColor = target.dataset.color;
      saveSettings(settings);
      applySettingsToDOM(true);
    }
  });

  // Eye custom color
  eyeCustomColor?.addEventListener("input", (e) => {
    const val = (e.target as HTMLInputElement).value;
    settings.eyeColor = val;
    saveSettings(settings);
    applySettingsToDOM(true);
  });

  // Outline toggle
  outlineToggle?.addEventListener("change", (e) => {
    settings.outlineEnabled = (e.target as HTMLInputElement).checked;
    saveSettings(settings);
    applySettingsToDOM(true);
  });

  // Match outline color to eye
  matchOutlineToggle?.addEventListener("change", (e) => {
    settings.matchOutlineColor = (e.target as HTMLInputElement).checked;
    saveSettings(settings);
    applySettingsToDOM(true);
  });

  // Outline color presets
  outlineColorGroup?.addEventListener("click", (e) => {
    const target = (e.target as HTMLElement).closest(".color-swatch") as HTMLElement;
    if (target && target.dataset.color) {
      settings.outlineColor = target.dataset.color;
      saveSettings(settings);
      applySettingsToDOM(true);
    }
  });

  // Outline custom color
  outlineCustomColor?.addEventListener("input", (e) => {
    const val = (e.target as HTMLInputElement).value;
    settings.outlineColor = val;
    saveSettings(settings);
    applySettingsToDOM(true);
  });

  // Wiggle toggle
  wiggleToggle?.addEventListener("change", (e) => {
    settings.wiggleEnabled = (e.target as HTMLInputElement).checked;
    saveSettings(settings);
  });

  // Blink speed segment buttons
  blinkSpeedControl?.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest(".segment-btn") as HTMLElement;
    if (btn && btn.dataset.speed) {
      settings.blinkSpeed = btn.dataset.speed as "relaxed" | "normal" | "active";
      saveSettings(settings);
      applySettingsToDOM(true);
    }
  });

  // Scale segment buttons
  scaleControl?.addEventListener("click", async (e) => {
    const btn = (e.target as HTMLElement).closest(".segment-btn") as HTMLElement;
    if (btn && btn.dataset.scale) {
      const newScale = parseFloat(btn.dataset.scale);
      if (newScale !== settings.scale) {
        settings.scale = newScale;
        saveSettings(settings);
        applySettingsToDOM(true);
        await updateWindowSize();
      }
    }
  });

  // Reset settings
  resetSettingsBtn?.addEventListener("click", async () => {
    settings = { ...DEFAULT_SETTINGS };
    saveSettings(settings);
    applySettingsToDOM(true);
    await updateWindowSize();
  });

  /*
  Keep app on screen
  */

  async function keepWindowOnScreen() {
    const currentMon = await currentMonitor();

    if (!currentMon) {
      return;
    }

    const position = await appWindow.outerPosition();
    const size = await appWindow.outerSize();

    const workArea = currentMon.workArea;

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

  let checkInterval: ReturnType<typeof setInterval> | null = null;

  function scheduleKeepWindowOnScreen() {
    if (checkInterval) {
      clearInterval(checkInterval);
    }

    checkInterval = setInterval(async () => {
      try {
        const isDown = await invoke<boolean>("is_mouse_down");
        if (!isDown) {
          if (checkInterval) {
            clearInterval(checkInterval);
            checkInterval = null;
          }
          await keepWindowOnScreen();
        }
      } catch {
        if (checkInterval) {
          clearInterval(checkInterval);
          checkInterval = null;
        }
      }
    }, 40);
  }

  appWindow.onMoved(() => {
    scheduleKeepWindowOnScreen();
  });

  /*
  DRAGGING
  */

  widget?.addEventListener("mousedown", async (event) => {
    if ((event.target as HTMLElement)?.closest("#settings-toggle, #settings-panel")) {
      return;
    }

    if (event.button === 0) {
      scheduleKeepWindowOnScreen();
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
  WIGGLE
  */

  function triggerWiggle() {
    /*
      Don't wiggle if disabled, hovering, or settings open.
    */

    if (isHovered || isSettingsOpen || !settings.wiggleEnabled || !hoverArea) {
      return;
    }

    isWiggling = true;

    hoverArea.classList.remove("wiggle");
    void hoverArea.offsetWidth;
    hoverArea.classList.add("wiggle");
  }

  /*
  BLINKING
  */

  async function blink() {
    triggerWiggle();

    hoverArea?.classList.add("closed");

    await new Promise((resolve) => {
      setTimeout(resolve, 160);
    });

    hoverArea?.classList.remove("closed");
  }

  function randomDelay(min: number, max: number) {
    return Math.floor(
      Math.random() * (max - min + 1) + min
    );
  }

  function getBlinkDelayRange(speed: "relaxed" | "normal" | "active") {
    switch (speed) {
      case "relaxed":
        return { min: 6000, max: 12000 };
      case "active":
        return { min: 1500, max: 4000 };
      case "normal":
      default:
        return { min: 3000, max: 8000 };
    }
  }

  async function blinkLoop() {
    while (true) {
      const { min, max } = getBlinkDelayRange(settings.blinkSpeed);
      const delay = randomDelay(min, max);

      await new Promise((resolve) => {
        setTimeout(resolve, delay);
      });

      await blink();

      /*
        Occasionally perform a second blink shortly afterward.
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

    if (isWiggling) {
      hoverArea.classList.remove("wiggle");
      isWiggling = false;
    }
  });

  hoverArea?.addEventListener("mouseleave", () => {
    isHovered = false;
  });

  /*
  When the CSS animation finishes,
  clean up the class and allow another wiggle.
  */

  hoverArea?.addEventListener("animationend", () => {
    hoverArea.classList.remove("wiggle");
    isWiggling = false;
  });
});