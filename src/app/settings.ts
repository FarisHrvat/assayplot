import { useEffect, useState } from 'react';
// @ts-ignore - the statistics core is plain JS.
import { setMaxEnumerations } from '../core/exact.js';
import { setDisplayPreferences } from './model.ts';

export interface Settings {
  /**
   * Draws every series with its own marker shape as well as its own colour, and
   * makes new figures default to the colour-blind safe palette. Shape is the
   * part that actually matters: about one man in twelve cannot reliably tell
   * red from green, and no palette fixes a figure that encodes meaning in hue
   * alone.
   */
  colourBlindSafe: boolean;
  /**
   * How much of the machine an analysis may use. Never all of it: the browser
   * still has to draw, and a frozen interface reads as a crash.
   */
  effort: 'light' | 'balanced' | 'thorough';
  /** Ask GitHub for a newer release once per launch. */
  checkForUpdates: boolean;
  /** Decimal places shown in results. The stored numbers keep full precision. */
  decimals: number;
  /**
   * Show exact p-values rather than "< 0.0001". Journals increasingly ask for
   * the number, and a threshold hides how far past it a result is.
   */
  exactPValues: boolean;
  /** Default DPI offered in the export dialog. */
  exportDpi: number;
  /** Default palette for new figures. */
  palette: string;
  /** Default width and height, in points, for a new figure. */
  figureWidth: number;
  figureHeight: number;
  /** Warn before closing a table that analyses or figures are built on. */
  confirmClose: boolean;
  /** Minutes between autosaves. */
  autosaveMinutes: number;
  /** Interface scale, for a 13-inch laptop or a 33-inch monitor. */
  density: 'compact' | 'normal' | 'roomy';
}

const KEY = 'assayplot.settings';

const DEFAULTS: Settings = {
  colourBlindSafe: false,
  effort: 'balanced',
  checkForUpdates: true,
  decimals: 4,
  exactPValues: false,
  exportDpi: 300,
  palette: 'assayplot',
  figureWidth: 520,
  figureHeight: 380,
  confirmClose: true,
  autosaveMinutes: 1,
  density: 'normal',
};

/** A fresh copy of the defaults, for the reset button. */
export const defaultSettings = (): Settings => ({ ...DEFAULTS });

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return DEFAULTS;
  }
}

function store(settings: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* not remembered */
  }
}

// Read outside React by the figure engine, which has no hooks.
let current = typeof localStorage === 'undefined' ? DEFAULTS : loadSettings();
const listeners = new Set<(settings: Settings) => void>();

export const getSettings = () => current;

export function setSettings(next: Settings) {
  current = next;
  store(next);
  setMaxEnumerations(budget().enumerations);
  applyDisplay(next);
  applyDensity(next.density);
  listeners.forEach((listener) => listener(next));
}

function applyDisplay(settings: Settings) {
  setDisplayPreferences({
    decimals: settings.decimals,
    exactPValues: settings.exactPValues,
    figureWidth: settings.figureWidth,
    figureHeight: settings.figureHeight,
    palette: settings.palette,
  });
}

/** Density is a root attribute so the stylesheet can scale everything at once. */
export function applyDensity(density: Settings['density']) {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-density', density);
}

export function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const [settings, setLocal] = useState<Settings>(current);

  useEffect(() => {
    listeners.add(setLocal);
    return () => { listeners.delete(setLocal); };
  }, []);

  return [settings, (patch) => setSettings({ ...current, ...patch })];
}

/**
 * How many arrangements an exact test may enumerate, and how many points a
 * figure will draw individually before it thins them. Scales with the effort
 * setting and with the number of cores the machine reports, capped so a
 * background tab never takes the whole machine.
 */
export function budget(): { enumerations: number; pointsPerSeries: number } {
  const cores = typeof navigator === 'undefined' ? 4 : (navigator.hardwareConcurrency || 4);
  // Leave at least a quarter of the machine alone.
  const usable = Math.max(1, Math.floor(cores * 0.75));
  const scale = { light: 0.4, balanced: 1, thorough: 2.5 }[current.effort];

  return {
    enumerations: Math.round(Math.min(2_000_000, 150_000 * usable * scale)),
    pointsPerSeries: Math.round(Math.min(20_000, 2_000 * usable * scale)),
  };
}

// Apply whatever was remembered from the last session.
setMaxEnumerations(budget().enumerations);
applyDisplay(current);
applyDensity(current.density);
