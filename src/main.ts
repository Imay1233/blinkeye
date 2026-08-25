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

  // Water Tracker Settings
  waterReminderEnabled: boolean;
  waterIntervalMinutes: number; // e.g. 15, 30, 45, 60 or custom
  waterGoalPreset: "standard" | "active" | "athlete" | "custom";
  waterGoalCustomMl: number;
  waterCupSizeMl: number;
}

const DEFAULT_SETTINGS: AppSettings = {
  eyeColor: "#ffffff",
  outlineColor: "#2f2f2f",
  outlineEnabled: true,
  matchOutlineColor: false,
  wiggleEnabled: true,
  blinkSpeed: "normal",
  scale: 1.0,

  waterReminderEnabled: true,
  waterIntervalMinutes: 30,
  waterGoalPreset: "standard",
  waterGoalCustomMl: 2000,
  waterCupSizeMl: 250,
};

interface WaterState {
  date: string; // YYYY-MM-DD
  currentMl: number;
}

function getTodayDateString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

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

function loadWaterState(): WaterState {
  const today = getTodayDateString();
  try {
    const saved = localStorage.getItem("blinkeye_water_state");
    if (saved) {
      const parsed: WaterState = JSON.parse(saved);
      if (parsed.date === today) {
        return parsed;
      }
    }
  } catch (e) {
    console.error("Failed to load water state", e);
  }
  return { date: today, currentMl: 0 };
}

function saveWaterState(state: WaterState) {
  try {
    localStorage.setItem("blinkeye_water_state", JSON.stringify(state));
  } catch (e) {
    console.error("Failed to save water state", e);
  }
}

function getDailyGoalMl(settings: AppSettings): number {
  switch (settings.waterGoalPreset) {
    case "standard":
      return 2000;
    case "active":
      return 2600;
    case "athlete":
      return 3200;
    case "custom":
      return settings.waterGoalCustomMl || 2000;
  }
}

window.addEventListener("DOMContentLoaded", async () => {
  let settings: AppSettings = loadSettings();
  let waterState: WaterState = loadWaterState();

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
  const waterToggle = document.getElementById("water-toggle");

  // Water elements
  const waterDropletSvg = document.getElementById("water-droplet-svg");
  const waterSkipBtn = document.getElementById("water-skip-btn");
  const waterOneCupBtn = document.getElementById("water-one-cup-btn");
  const waterCupBtnLabel = document.getElementById("water-cup-btn-label");
  const waterCustomToggleBtn = document.getElementById("water-custom-toggle-btn");
  const waterCustomPopover = document.getElementById("water-custom-popover");
  const waterCustomInput = document.getElementById("water-custom-input") as HTMLInputElement;
  const waterCustomSubmitBtn = document.getElementById("water-custom-submit-btn");
  const waterMinusBtn = document.getElementById("water-minus-btn");
  const waterPlusBtn = document.getElementById("water-plus-btn");
  const waterProgressText = document.getElementById("water-progress-text");
  const liquidFillGroup = document.getElementById("liquid-fill-group");

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

  // Water Settings Elements
  const waterReminderToggle = document.getElementById("water-reminder-toggle") as HTMLInputElement;
  const waterSettingsBody = document.getElementById("water-settings-body");
  const waterTestBtn = document.getElementById("water-test-btn");
  const waterIntervalControl = document.getElementById("water-interval-control");
  const waterCustomIntervalContainer = document.getElementById("water-custom-interval-container");
  const waterCustomIntervalInput = document.getElementById("water-custom-interval-input") as HTMLInputElement;
  const waterGoalControl = document.getElementById("water-goal-control");
  const waterCustomGoalContainer = document.getElementById("water-custom-goal-container");
  const waterCustomGoalInput = document.getElementById("water-custom-goal-input") as HTMLInputElement;
  const waterCupControl = document.getElementById("water-cup-control");
  const cupSizeLabel = document.getElementById("cup-size-label");
  const waterStatusVal = document.getElementById("water-status-val");
  const waterResetTodayBtn = document.getElementById("water-reset-today-btn");

  let isHovered = false;
  let isWiggling = false;
  let isSettingsOpen = false;
  let isWaterAlarm = false;
  let isWaterManual = false;

  function getWindowSizes(scale: number) {
    const cardWidth = Math.round(180 * scale + 22);
    const cardHeight = Math.round(180 * scale + 22);

    const normalWidth = cardWidth + 60;
    const normalHeight = cardHeight + 60;

    // Settings panel (460px) + eye card + margins must fit with breathing room
    const expandedWidth = cardWidth + 530;
    const expandedHeight = Math.max(normalHeight, 560);

    return { normalWidth, normalHeight, expandedWidth, expandedHeight };
  }

  async function updateWindowSize() {
    const sizes = getWindowSizes(settings.scale);
    let width = sizes.normalWidth;
    let height = sizes.normalHeight;
    if (isSettingsOpen) {
      width = sizes.expandedWidth;
      height = sizes.expandedHeight;
    } else if (isWaterAlarm || isWaterManual) {
      // Extra room so the alarm action bar stays fully visible while the droplet wiggles
      height = sizes.normalHeight + 24;
    }

    // Never request a window bigger than the monitor work area (small screens / high DPI)
    const mon = await currentMonitor();
    if (mon) {
      const scaleFactor = mon.scaleFactor || 1;
      const maxLogicalWidth = Math.floor((mon.workArea.size.width - 16) / scaleFactor);
      const maxLogicalHeight = Math.floor((mon.workArea.size.height - 16) / scaleFactor);
      width = Math.min(width, maxLogicalWidth);
      height = Math.min(height, maxLogicalHeight);
    }

    await appWindow.setSize(new LogicalSize(width, height));
    await keepWindowOnScreen();
  }

  function updateWaterProgressDOM() {
    const today = getTodayDateString();
    if (waterState.date !== today) {
      waterState = { date: today, currentMl: 0 };
      saveWaterState(waterState);
    }

    const goal = getDailyGoalMl(settings);
    const ratio = Math.min(Math.max(waterState.currentMl / goal, 0), 1);
    const percentage = Math.round(ratio * 100);

    // Liquid container total cavity height is ~159px, from Y 11 to 170
    const targetY = 170 - (ratio * 159);
    if (liquidFillGroup) {
      liquidFillGroup.style.transform = `translateY(${targetY}px)`;
    }

    const progressStr = `${waterState.currentMl} / ${goal} ml (${percentage}%)`;
    if (waterProgressText) {
      waterProgressText.textContent = progressStr;
    }
    if (waterStatusVal) {
      waterStatusVal.textContent = progressStr;
    }
    if (waterCupBtnLabel) {
      waterCupBtnLabel.textContent = `1 CUP (${settings.waterCupSizeMl}ml)`;
    }
    if (cupSizeLabel) {
      cupSizeLabel.textContent = `${settings.waterCupSizeMl} ml`;
    }
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

    updateWaterProgressDOM();

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

    // 6. Water Reminder Toggle
    if (waterReminderToggle) {
      waterReminderToggle.checked = settings.waterReminderEnabled;
    }
    if (waterSettingsBody) {
      if (settings.waterReminderEnabled) {
        waterSettingsBody.classList.remove("disabled");
      } else {
        waterSettingsBody.classList.add("disabled");
      }
    }

    // 7. Water Interval
    let isPresetInterval = false;
    waterIntervalControl?.querySelectorAll(".segment-btn").forEach((btn) => {
      const intervalVal = (btn as HTMLElement).dataset.interval;
      if (intervalVal && parseInt(intervalVal) === settings.waterIntervalMinutes) {
        btn.classList.add("active");
        isPresetInterval = true;
      } else if (intervalVal === "custom" && !isPresetInterval) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    });
    if (waterCustomIntervalContainer) {
      waterCustomIntervalContainer.style.display = isPresetInterval ? "none" : "flex";
    }
    if (waterCustomIntervalInput) {
      waterCustomIntervalInput.value = settings.waterIntervalMinutes.toString();
    }

    // 8. Water Goal
    waterGoalControl?.querySelectorAll(".segment-btn").forEach((btn) => {
      const goal = (btn as HTMLElement).dataset.goal;
      if (goal === settings.waterGoalPreset) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    });
    if (waterCustomGoalContainer) {
      waterCustomGoalContainer.style.display = settings.waterGoalPreset === "custom" ? "flex" : "none";
    }
    if (waterCustomGoalInput) {
      waterCustomGoalInput.value = (settings.waterGoalCustomMl || 2000).toString();
    }

    // 9. Water Cup Size
    waterCupControl?.querySelectorAll(".segment-btn").forEach((btn) => {
      const cupVal = parseInt((btn as HTMLElement).dataset.cup || "250");
      if (cupVal === settings.waterCupSizeMl) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    });

    // 10. Scale control
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

  // Bug 1: reveal widget now that settings are applied (avoids flash of default state)
  requestAnimationFrame(() => {
    widget?.classList.add("ready");
  });

  /*
  WATER REMINDER & TRACKER STATE LOGIC
  */

  async function showWaterAlarm() {
    isWaterAlarm = true;
    isWaterManual = false;
    hoverArea?.classList.add("water-mode", "water-alarm");
    hoverArea?.classList.remove("water-manual");
    waterToggle?.classList.add("active");
    updateWaterProgressDOM();
    await updateWindowSize();
  }

  async function showWaterManual() {
    isWaterManual = true;
    isWaterAlarm = false;
    hoverArea?.classList.add("water-mode", "water-manual");
    hoverArea?.classList.remove("water-alarm");
    waterToggle?.classList.add("active");
    updateWaterProgressDOM();
    await updateWindowSize();
  }

  async function showEyeMode() {
    isWaterAlarm = false;
    isWaterManual = false;
    hoverArea?.classList.remove("water-mode", "water-alarm", "water-manual", "wiggle-paused");
    waterToggle?.classList.remove("active");
    waterCustomPopover?.classList.remove("open");
    await updateWindowSize();
  }

  function toggleWaterManual() {
    if (isWaterAlarm) {
      dismissWaterAlarm();
      return;
    }
    if (isWaterManual) {
      showEyeMode();
    } else {
      showWaterManual();
    }
  }

  function logWaterIntake(amountMl: number) {
    const today = getTodayDateString();
    if (waterState.date !== today) {
      waterState = { date: today, currentMl: 0 };
    }
    waterState.currentMl = Math.max(0, waterState.currentMl + amountMl);
    saveWaterState(waterState);
    updateWaterProgressDOM();
  }

  function dismissWaterAlarm() {
    if (isWaterAlarm) {
      showEyeMode();
      resetWaterReminderTimer();
    }
  }

  let waterReminderTimeout: ReturnType<typeof setTimeout> | null = null;

  function resetWaterReminderTimer() {
    if (waterReminderTimeout) {
      clearTimeout(waterReminderTimeout);
      waterReminderTimeout = null;
    }

    if (!settings.waterReminderEnabled) return;

    const ms = Math.max(1, settings.waterIntervalMinutes) * 60 * 1000;
    waterReminderTimeout = setTimeout(() => {
      if (settings.waterReminderEnabled && !isSettingsOpen) {
        showWaterAlarm();
      } else {
        resetWaterReminderTimer();
      }
    }, ms);
  }

  // Start water timer
  resetWaterReminderTimer();

  /*
  WATER EVENT HANDLERS
  */

  waterToggle?.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleWaterManual();
  });

  waterSkipBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    dismissWaterAlarm();
  });

  waterOneCupBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    logWaterIntake(settings.waterCupSizeMl);
    setTimeout(() => {
      dismissWaterAlarm();
    }, 850);
  });

  waterDropletSvg?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (isWaterAlarm) {
      logWaterIntake(settings.waterCupSizeMl);
      setTimeout(() => {
        dismissWaterAlarm();
      }, 850);
    }
  });

  waterCustomToggleBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    waterCustomPopover?.classList.toggle("open");
  });

  waterCustomPopover?.querySelectorAll(".quick-add-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const amount = parseInt((btn as HTMLElement).dataset.amount || "250");
      logWaterIntake(amount);
      waterCustomPopover?.classList.remove("open");
      if (isWaterAlarm) {
        setTimeout(() => dismissWaterAlarm(), 850);
      }
    });
  });

  waterCustomSubmitBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    const amount = parseInt(waterCustomInput?.value || "250");
    if (!isNaN(amount) && amount > 0) {
      logWaterIntake(amount);
      waterCustomPopover?.classList.remove("open");
      if (isWaterAlarm) {
        setTimeout(() => dismissWaterAlarm(), 850);
      }
    }
  });

  waterPlusBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    logWaterIntake(settings.waterCupSizeMl);
  });

  waterMinusBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    logWaterIntake(-settings.waterCupSizeMl);
  });

  waterTestBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (isSettingsOpen) {
      toggleSettings();
    }
    setTimeout(() => {
      showWaterAlarm();
    }, 300);
  });

  waterResetTodayBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    waterState.currentMl = 0;
    saveWaterState(waterState);
    updateWaterProgressDOM();
  });

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

  // Water Reminder Toggle
  waterReminderToggle?.addEventListener("change", (e) => {
    settings.waterReminderEnabled = (e.target as HTMLInputElement).checked;
    saveSettings(settings);
    applySettingsToDOM(true);
    resetWaterReminderTimer();
  });

  // Water Interval Segment Buttons
  waterIntervalControl?.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest(".segment-btn") as HTMLElement;
    if (btn && btn.dataset.interval) {
      const val = btn.dataset.interval;
      if (val === "custom") {
        if (waterCustomIntervalContainer) {
          waterCustomIntervalContainer.style.display = "flex";
        }
        waterIntervalControl.querySelectorAll(".segment-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
      } else {
        settings.waterIntervalMinutes = parseInt(val);
        saveSettings(settings);
        applySettingsToDOM(true);
        resetWaterReminderTimer();
      }
    }
  });

  // Water Custom Interval Input
  waterCustomIntervalInput?.addEventListener("change", (e) => {
    const val = parseInt((e.target as HTMLInputElement).value);
    if (!isNaN(val) && val > 0) {
      settings.waterIntervalMinutes = val;
      saveSettings(settings);
      resetWaterReminderTimer();
    }
  });

  // Water Goal Segment Buttons
  waterGoalControl?.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest(".segment-btn") as HTMLElement;
    if (btn && btn.dataset.goal) {
      settings.waterGoalPreset = btn.dataset.goal as "standard" | "active" | "athlete" | "custom";
      saveSettings(settings);
      applySettingsToDOM(true);
    }
  });

  // Water Custom Goal Input
  waterCustomGoalInput?.addEventListener("change", (e) => {
    const val = parseInt((e.target as HTMLInputElement).value);
    if (!isNaN(val) && val >= 100) {
      settings.waterGoalCustomMl = val;
      saveSettings(settings);
      updateWaterProgressDOM();
    }
  });

  // Water Cup Size Control
  waterCupControl?.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest(".segment-btn") as HTMLElement;
    if (btn && btn.dataset.cup) {
      settings.waterCupSizeMl = parseInt(btn.dataset.cup);
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
    resetWaterReminderTimer();
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
    if ((event.target as HTMLElement)?.closest("#settings-toggle, #water-toggle, #settings-panel, #water-action-bar, #water-manual-bar")) {
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
      Don't wiggle if disabled, hovering, in water mode, or settings open.
    */
    if (isHovered || isSettingsOpen || isWaterAlarm || isWaterManual || !settings.wiggleEnabled || !hoverArea) {
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
    if (isWaterAlarm || isWaterManual) {
      return;
    }

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

    // Bug 3: pause water alarm wiggle while hovering so user can click buttons comfortably
    if (isWaterAlarm) {
      hoverArea.classList.add("wiggle-paused");
    }
  });

  hoverArea?.addEventListener("mouseleave", () => {
    isHovered = false;

    // Resume alarm wiggle when mouse leaves
    if (isWaterAlarm) {
      hoverArea?.classList.remove("wiggle-paused");
    }
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