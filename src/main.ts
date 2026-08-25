import "./styles.css";

import { invoke } from "@tauri-apps/api/core";
import {
  getCurrentWindow,
  currentMonitor,
} from "@tauri-apps/api/window";

import { PhysicalPosition, LogicalSize, LogicalPosition } from "@tauri-apps/api/dpi";
import { listen, emit } from "@tauri-apps/api/event";

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

/*
Timing constants (milliseconds unless noted otherwise).
*/
const BLINK_CLOSED_MS = 160; // how long the eyelid stays shut during a blink
const SECOND_BLINK_MIN_MS = 250; // window for the occasional follow-up blink...
const SECOND_BLINK_MAX_MS = 500; // ...so it reads as a natural double-blink
const DOUBLE_BLINK_CHANCE = 0.2; // probability that a blink is followed by a second one
const DISMISS_AFTER_LOG_MS = 850; // lets the user see the level rise before the alarm closes
const TEST_ALARM_DELAY_MS = 300; // waits for the settings panel to close first
const SETTINGS_RESIZE_DELAY_MS = 280; // matches the CSS settings-panel transition duration
const DRAG_MOUSE_POLL_MS = 40; // drag-end detection rate while dragging
const DAY_CHECK_INTERVAL_MS = 30 * 1000;

/*
Water goals (ml) per activity preset.
*/
const WATER_GOALS_ML = { standard: 2000, active: 2600, athlete: 3200 } as const;
const DEFAULT_GOAL_ML = WATER_GOALS_ML.standard;

/*
Droplet cavity geometry inside the water SVG (viewBox units):
the liquid travels from Y=170 (empty) up 159px when the goal is reached.
*/
const WATER_CAVITY_BOTTOM_Y = 170;
const WATER_CAVITY_TRAVEL_PX = 159;

/*
Widget window sizing (logical px): eye card plus breathing room; the
settings panel docks beside the card and must fit on screen too.
*/
const EYE_CARD_BASE_PX = 180;
const EYE_CARD_EXTRA_PX = 22;
const WINDOW_MARGIN_PX = 60;
const SETTINGS_PANEL_WIDTH_PX = 530;
const MIN_EXPANDED_HEIGHT_PX = 560;
const WATER_ALARM_EXTRA_HEIGHT_PX = 24;
const WORK_AREA_MARGIN_PX = 16;

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
  waterGoalCustomMl: DEFAULT_GOAL_ML,
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
  if (settings.waterGoalPreset === "custom") {
    return settings.waterGoalCustomMl || DEFAULT_GOAL_ML;
  }
  return WATER_GOALS_ML[settings.waterGoalPreset];
}

/*
Highlight exactly one .segment-btn per control: the first whose dataset key
matches. Kept as a predicate so numeric attributes (scale "0.5"/"1.0") can
compare numerically while string attributes compare literally.
*/
function syncSegmentedControl(
  control: HTMLElement | null,
  matches: (btn: HTMLElement) => boolean
) {
  control?.querySelectorAll<HTMLElement>(".segment-btn").forEach((btn) => {
    btn.classList.toggle("active", matches(btn));
  });
}

/*
Highlight the color swatch matching `color` (case-insensitive); when none
matches, highlight the custom-color button instead and mirror the chosen
color into its input.
*/
function syncColorSwatches(
  group: HTMLElement | null,
  customInput: HTMLInputElement | null,
  color: string
) {
  group?.querySelectorAll<HTMLElement>(".color-swatch").forEach((btn) => {
    btn.classList.toggle(
      "active",
      (btn.dataset.color ?? "").toLowerCase() === color.toLowerCase()
    );
  });

  const customBtn = customInput?.closest(".custom-color-btn");
  const matchesPreset = Array.from(
    group?.querySelectorAll<HTMLElement>(".color-swatch") ?? []
  ).some((b) => (b.dataset.color ?? "").toLowerCase() === color.toLowerCase());

  customBtn?.classList.toggle("active", !matchesPreset);

  if (customInput) {
    customInput.value = color;
  }
}

window.addEventListener("DOMContentLoaded", async () => {
  let settings: AppSettings = loadSettings();
  let waterState: WaterState = loadWaterState();

  /*
  Position the widget before it is ever visible:
  - If a previous session saved a position, Rust already applied it while the
    window was still hidden (see setup in lib.rs) — nothing to do here.
  - Otherwise (first run / cleared state), center it on the current monitor.
  The window itself is only revealed further below, after the final position
  AND size have been applied, so none of this can flicker.
  */
  try {
    const savedPosition = await invoke<{ x: number; y: number } | null>(
      "load_window_position"
    );

    if (!savedPosition) {
      await centerWindowOnMonitor();
    }
  } catch (e) {
    console.error("Failed to restore window position", e);
    await centerWindowOnMonitor();
  }

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
    const cardWidth = Math.round(EYE_CARD_BASE_PX * scale + EYE_CARD_EXTRA_PX);
    const cardHeight = Math.round(EYE_CARD_BASE_PX * scale + EYE_CARD_EXTRA_PX);

    const normalWidth = cardWidth + WINDOW_MARGIN_PX;
    const normalHeight = cardHeight + WINDOW_MARGIN_PX;

    // Settings panel docks beside the card; everything must fit with breathing room
    const expandedWidth = cardWidth + SETTINGS_PANEL_WIDTH_PX;
    const expandedHeight = Math.max(normalHeight, MIN_EXPANDED_HEIGHT_PX);

    return { normalWidth, normalHeight, expandedWidth, expandedHeight };
  }

  /*
  HiDPI-safe centering. The monitor size is in physical pixels;
  dividing by scaleFactor gives logical units, so the widget is centered
  correctly on scaled displays. Uses the real widget size for the current
  saved scale.
  */
  async function centerWindowOnMonitor() {
    const mon = await currentMonitor();
    if (!mon) {
      return;
    }

    const scaleFactor = mon.scaleFactor || 1;
    const { normalWidth, normalHeight } = getWindowSizes(settings.scale);

    const logicalX = Math.round(
      mon.size.width / scaleFactor / 2 - normalWidth / 2
    );
    const logicalY = Math.round(
      mon.size.height / scaleFactor / 2 - normalHeight / 2
    );

    await appWindow.setPosition(new LogicalPosition(logicalX, logicalY));
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
      height = sizes.normalHeight + WATER_ALARM_EXTRA_HEIGHT_PX;
    }

    // Never request a window bigger than the monitor work area (small screens / high DPI)
    const mon = await currentMonitor();
    if (mon) {
      const scaleFactor = mon.scaleFactor || 1;
      const maxLogicalWidth = Math.floor(
        (mon.workArea.size.width - WORK_AREA_MARGIN_PX) / scaleFactor
      );
      const maxLogicalHeight = Math.floor(
        (mon.workArea.size.height - WORK_AREA_MARGIN_PX) / scaleFactor
      );
      width = Math.min(width, maxLogicalWidth);
      height = Math.min(height, maxLogicalHeight);
    }

    await appWindow.setSize(new LogicalSize(width, height));
    await keepWindowOnScreen();
  }

  // True when today intake has reached the daily norm (stale date counts as below norm)
  function isWaterGoalReached(): boolean {
    return waterState.date === getTodayDateString() && waterState.currentMl >= getDailyGoalMl(settings);
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

    // Daily norm reached: flag it so CSS can glow the droplet and show the badge
    const goalReached = waterState.currentMl > 0 && waterState.currentMl >= goal;
    if (hoverArea) {
      hoverArea.classList.toggle("goal-reached", goalReached);
    }

    // Liquid level: cavity spans WATER_CAVITY_TRAVEL_PX up from the bottom
    const targetY = WATER_CAVITY_BOTTOM_Y - ratio * WATER_CAVITY_TRAVEL_PX;
    if (liquidFillGroup) {
      liquidFillGroup.style.transform = `translateY(${targetY}px)`;
    }

    const progressStr = goalReached ? "Goal reached!" : `${waterState.currentMl} / ${goal} ml (${percentage}%)`;
    const statusStr = goalReached ? `Daily norm reached! (${waterState.currentMl} / ${goal} ml)` : progressStr;
    if (waterProgressText) {
      waterProgressText.textContent = progressStr;
    }
    if (waterStatusVal) {
      waterStatusVal.textContent = statusStr;
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
    syncColorSwatches(eyeColorGroup, eyeCustomColor, settings.eyeColor);

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
    syncColorSwatches(outlineColorGroup, outlineCustomColor, settings.outlineColor);

    // 4. Wiggle toggle
    if (wiggleToggle) {
      wiggleToggle.checked = settings.wiggleEnabled;
    }

    // 5. Blink speed segments
    syncSegmentedControl(blinkSpeedControl, (btn) => btn.dataset.speed === settings.blinkSpeed);

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
    syncSegmentedControl(waterGoalControl, (btn) => btn.dataset.goal === settings.waterGoalPreset);
    if (waterCustomGoalContainer) {
      waterCustomGoalContainer.style.display = settings.waterGoalPreset === "custom" ? "flex" : "none";
    }
    if (waterCustomGoalInput) {
      waterCustomGoalInput.value = (settings.waterGoalCustomMl || DEFAULT_GOAL_ML).toString();
    }

    // 9. Water Cup Size
    syncSegmentedControl(
      waterCupControl,
      (btn) => btn.dataset.cup === String(settings.waterCupSizeMl)
    );

    // 10. Scale control (numeric compare: dataset "1.0" must match scale 1)
    syncSegmentedControl(scaleControl, (btn) => parseFloat(btn.dataset.scale || "") === settings.scale);

    if (scaleValLabel) {
      scaleValLabel.textContent = `${settings.scale}x`;
    }
  }

  // Initial apply (everything up to this point ran while the window was hidden)
  applySettingsToDOM(true);
  await updateWindowSize();

  // Reveal: the widget fades in while the window appears directly in its
  // final position and size — no jumping, resizing or flashing.
  widget?.classList.add("ready");
  await appWindow.show();

  // Tell Rust the UI booted successfully (disarms the startup watchdog)
  emit("widget://ready").catch(() => {});

  /*
  WATER REMINDER & TRACKER STATE LOGIC
  */

  /*
  Enter the water UI in one of its two flavors: the reminder alarm or the
  manual tracker opened via the droplet button.
  */
  async function showWaterMode(mode: "alarm" | "manual") {
    isWaterAlarm = mode === "alarm";
    isWaterManual = mode === "manual";
    hoverArea?.classList.add("water-mode", mode === "alarm" ? "water-alarm" : "water-manual");
    hoverArea?.classList.remove(mode === "alarm" ? "water-manual" : "water-alarm");
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
      showWaterMode("manual");
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
    // Re-evaluate the reminder: reaching the norm cancels it, dropping below re-arms it
    resetWaterReminderTimer();
  }

  /*
  Log intake, then give the user a moment to see the level rise before the
  alarm UI closes itself. Safe outside alarm mode too: dismissal no-ops.
  */
  function logWaterIntakeAndDismiss(amountMl: number) {
    logWaterIntake(amountMl);
    if (isWaterAlarm) {
      setTimeout(dismissWaterAlarm, DISMISS_AFTER_LOG_MS);
    }
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
    // Daily norm reached: no more reminders for the rest of the day
    if (isWaterGoalReached()) return;

    const ms = Math.max(1, settings.waterIntervalMinutes) * 60 * 1000;
    waterReminderTimeout = setTimeout(() => {
      if (settings.waterReminderEnabled && !isSettingsOpen && !isWaterGoalReached()) {
        showWaterMode("alarm");
      } else {
        resetWaterReminderTimer();
      }
    }, ms);
  }

  // Start water timer
  resetWaterReminderTimer();

  /*
  DAY ROLLOVER
  The water tracker already resets itself whenever it notices a stale date
  (launch, logging a cup, any UI refresh). But if the widget sits idle across
  midnight - no clicks, no reminder firing - nothing re-checks the date, so
  yesterday's count would stay on screen until the next interaction.
  Poll cheaply (every 30s) and roll the day over automatically.
  Polling (instead of a one-shot midnight timeout) also survives sleep/wake,
  manual clock changes and DST shifts.
  */
  let lastKnownDay = getTodayDateString();

  setInterval(() => {
    const now = getTodayDateString();

    if (now === lastKnownDay) {
      return;
    }

    lastKnownDay = now;

    // New day detected: start a fresh water count
    waterState = { date: now, currentMl: 0 };
    saveWaterState(waterState);
    updateWaterProgressDOM();

    // Restart the reminder cadence for the new day
    resetWaterReminderTimer();
  }, DAY_CHECK_INTERVAL_MS);

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
    logWaterIntakeAndDismiss(settings.waterCupSizeMl);
  });

  waterDropletSvg?.addEventListener("click", (e) => {
    e.stopPropagation();
    // Only the alarm flavor reacts to droplet clicks; manual mode uses +/- buttons
    if (isWaterAlarm) {
      logWaterIntakeAndDismiss(settings.waterCupSizeMl);
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
      logWaterIntakeAndDismiss(amount);
      waterCustomPopover?.classList.remove("open");
    });
  });

  waterCustomSubmitBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    const amount = parseInt(waterCustomInput?.value || "250");
    if (!isNaN(amount) && amount > 0) {
      logWaterIntakeAndDismiss(amount);
      waterCustomPopover?.classList.remove("open");
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
      showWaterMode("alarm");
    }, TEST_ALARM_DELAY_MS);
  });

  waterResetTodayBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    waterState.currentMl = 0;
    saveWaterState(waterState);
    updateWaterProgressDOM();
    resetWaterReminderTimer();
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
      }, SETTINGS_RESIZE_DELAY_MS);
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

  /*
  SYSTEM TRAY EVENTS
  */
  listen("tray://settings", async () => {
    if (!isSettingsOpen) {
      await toggleSettings();
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

    // Remember where the widget ended up so the next launch can restore it
    // before anything is visible.
    await saveWindowPosition(position);
  }

  /*
  Persist the window position to disk (via save_window_position in lib.rs).
  Called after every settle point: drag end (through keepWindowOnScreen),
  the startup clamp and every resize-triggered clamp.
  */
  async function saveWindowPosition(knownPosition?: PhysicalPosition) {
    try {
      const position = knownPosition ?? (await appWindow.outerPosition());
      await invoke("save_window_position", { x: position.x, y: position.y });
    } catch (e) {
      console.error("Failed to save window position", e);
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
    }, DRAG_MOUSE_POLL_MS);
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
      setTimeout(resolve, BLINK_CLOSED_MS);
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
      if (Math.random() < DOUBLE_BLINK_CHANCE) {
        await new Promise((resolve) => {
          setTimeout(resolve, randomDelay(SECOND_BLINK_MIN_MS, SECOND_BLINK_MAX_MS));
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

    // Pause water alarm wiggle while hovering so the user can click buttons comfortably
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