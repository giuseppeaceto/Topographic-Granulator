export const GRAIN_SIZE_MIN_MS = 10;
export const GRAIN_SIZE_CLASSIC_MAX_MS = 200;
export const GRAIN_SIZE_ABS_MAX_MS = 120_000;
export const RANDOM_START_MIN_MS = 0;
export const DENSITY_MIN = 1;
export const DENSITY_MAX = 60;
export const DENSITY_ENGINE_MIN = 0.1;

/** First 55% of the grain/rand knob stays in classic granular range. */
const DURATION_KNOB_SPLIT_NORM = 0.55;
const CLASSIC_MAX_OVERLAP = 8;
const LOOP_OVERLAP = 1.15;

export type TimeRegion = { start: number; end: number } | null | undefined;

export function regionDurationMs(region: TimeRegion, bufferDurationSec?: number | null): number {
	if (region && Number.isFinite(region.start) && Number.isFinite(region.end) && region.end > region.start) {
		return (region.end - region.start) * 1000;
	}
	if (bufferDurationSec && bufferDurationSec > 0) {
		return bufferDurationSec * 1000;
	}
	return GRAIN_SIZE_CLASSIC_MAX_MS;
}

export function grainSizeMaxMs(region: TimeRegion, bufferDurationSec?: number | null): number {
	const regionMs = regionDurationMs(region, bufferDurationSec);
	return Math.min(GRAIN_SIZE_ABS_MAX_MS, Math.max(GRAIN_SIZE_MIN_MS, Math.round(regionMs)));
}

export function randomStartMaxMs(region: TimeRegion, bufferDurationSec?: number | null): number {
	return grainSizeMaxMs(region, bufferDurationSec);
}

export function clampGrainSizeMs(ms: number, region: TimeRegion, bufferDurationSec?: number | null): number {
	const max = grainSizeMaxMs(region, bufferDurationSec);
	return Math.max(GRAIN_SIZE_MIN_MS, Math.min(max, Math.round(ms)));
}

export function clampRandomStartMs(ms: number, region: TimeRegion, bufferDurationSec?: number | null): number {
	const max = randomStartMaxMs(region, bufferDurationSec);
	return Math.max(RANDOM_START_MIN_MS, Math.min(max, Math.round(ms)));
}

export function formatDurationMs(ms: number): string {
	const v = Math.max(0, ms);
	if (v >= 1000) {
		const sec = v / 1000;
		const digits = sec >= 10 ? 1 : sec >= 2 ? 1 : 2;
		return `${parseFloat(sec.toFixed(digits))}s`;
	}
	return String(Math.round(v));
}

export function durationKnobToNorm(value: number, min: number, max: number): number {
	const split = Math.min(GRAIN_SIZE_CLASSIC_MAX_MS, max);
	if (max <= split + 1) {
		return max <= min ? 0 : (value - min) / (max - min);
	}
	const v = Math.max(min, Math.min(max, value));
	if (v <= split) {
		return DURATION_KNOB_SPLIT_NORM * ((v - min) / Math.max(1, split - min));
	}
	return DURATION_KNOB_SPLIT_NORM
		+ (1 - DURATION_KNOB_SPLIT_NORM) * ((v - split) / Math.max(1, max - split));
}

export function durationKnobFromNorm(norm: number, min: number, max: number): number {
	const n = Math.max(0, Math.min(1, norm));
	const split = Math.min(GRAIN_SIZE_CLASSIC_MAX_MS, max);
	if (max <= split + 1) {
		return min + n * (max - min);
	}
	if (n <= DURATION_KNOB_SPLIT_NORM) {
		return min + (n / DURATION_KNOB_SPLIT_NORM) * (split - min);
	}
	return split
		+ ((n - DURATION_KNOB_SPLIT_NORM) / (1 - DURATION_KNOB_SPLIT_NORM)) * (max - split);
}

/** Thin spawn rate as grains grow, so a full-selection grain plays almost like a loop. */
export function effectiveDensity(density: number, grainSizeMs: number, regionMs: number): number {
	const d = Math.max(DENSITY_ENGINE_MIN, density);
	const grainMs = Math.max(GRAIN_SIZE_MIN_MS, grainSizeMs);
	if (grainMs <= GRAIN_SIZE_CLASSIC_MAX_MS) {
		return Math.min(DENSITY_MAX, d);
	}
	const span = Math.max(1, regionMs - GRAIN_SIZE_CLASSIC_MAX_MS);
	const t = Math.max(0, Math.min(1, (grainMs - GRAIN_SIZE_CLASSIC_MAX_MS) / span));
	const maxOverlap = CLASSIC_MAX_OVERLAP * (1 - t) + LOOP_OVERLAP * t;
	const grainSec = grainMs / 1000;
	return Math.max(DENSITY_ENGINE_MIN, Math.min(d, maxOverlap / grainSec));
}

export function toEngineGranular<T extends { grainSizeMs: number; density: number; randomStartMs: number }>(
	granular: T,
	region: TimeRegion,
	bufferDurationSec?: number | null
): T {
	const regionMs = grainSizeMaxMs(region, bufferDurationSec);
	const grainSizeMs = clampGrainSizeMs(granular.grainSizeMs, region, bufferDurationSec);
	return {
		...granular,
		grainSizeMs,
		randomStartMs: clampRandomStartMs(granular.randomStartMs, region, bufferDurationSec),
		density: effectiveDensity(granular.density, grainSizeMs, regionMs)
	};
}
