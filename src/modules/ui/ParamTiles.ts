import type { AppContext, KnobConfig, ParamTiles } from '../app/AppContext';
import type { EffectsParams } from '../effects/EffectsChain';
import type { GranularParams } from '../granular/GranularWorkletEngine';
import { quantizePitch } from '../utils/ScaleQuantizer';
import { markerDriftHz, markerDriftMs, markerHold, setMarkerDrift, setMarkerHold } from '../editor/MarkerStore';
import { logger } from '../utils/logger';
import {
	clampGrainSizeMs,
	clampRandomStartMs,
	durationKnobFromNorm,
	durationKnobToNorm,
	formatDurationMs,
	GRAIN_SIZE_CLASSIC_MAX_MS,
	GRAIN_SIZE_MIN_MS,
	grainSizeMaxMs,
	RANDOM_START_MIN_MS,
	randomStartMaxMs
} from '../utils/grainLimits';

export function createParamTiles(ctx: AppContext): ParamTiles {
function isMidiMetaKnob(id: string) {
	return id === 'midi-learn' || id === 'midi-keys';
}

function requestMidiAccess(onFail: () => void) {
	void ctx.host.initMIDI().then((ok) => {
		if (ok) return;
		onFail();
		ctx.tiles?.refreshFromState();
		logger.warn('Web MIDI not available or permission not granted.');
		alert('MIDI access was blocked. Restart the app, then click LEARN or KEYS again and allow MIDI if asked. Plug the controller in before opening Undergrain.');
	});
}

function activeDurationLimits() {
	const idx = ctx.state.activePadIndex ?? 0;
	const region = ctx.state.regions.get(idx);
	const duration = ctx.host.activeAudioBuffer()?.duration ?? ctx.state.buffer?.duration ?? null;
	return { region, duration };
}

function knobMin(cfg: KnobConfig) {
	return cfg.getMin?.() ?? cfg.min;
}

function knobMax(cfg: KnobConfig) {
	return cfg.getMax?.() ?? cfg.max;
}

function knobToNorm(cfg: KnobConfig, value: number) {
	const min = knobMin(cfg);
	const max = knobMax(cfg);
	if (max <= min) return 0;
	if (cfg.toNorm) return Math.max(0, Math.min(1, cfg.toNorm(value, min, max)));
	return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

function knobFromNorm(cfg: KnobConfig, norm: number) {
	const min = knobMin(cfg);
	const max = knobMax(cfg);
	const n = Math.max(0, Math.min(1, norm));
	if (cfg.fromNorm) return cfg.fromNorm(n, min, max);
	return min + n * (max - min);
}

function syncDurationKnobTooltips() {
	const { region, duration } = activeDurationLimits();
	const maxMs = grainSizeMaxMs(region, duration);
	const grainKnob = document.querySelector('.knob[data-knob="grain"]') as HTMLElement | null;
	if (grainKnob) {
		grainKnob.setAttribute(
			'data-tooltip',
			`Grain size from 10ms up to the selection length (${formatDurationMs(maxMs)}). Long grains approach a loop.`
		);
	}
	const randKnob = document.querySelector('.knob[data-knob="rand"]') as HTMLElement | null;
	if (randKnob) {
		randKnob.setAttribute(
			'data-tooltip',
			`Random start offset within the selection (0–${formatDurationMs(maxMs)}).`
		);
	}
}

// Helper to update granular params on active voice
function updateActiveVoiceGranular(p: Partial<GranularParams>) {
    if (ctx.state.activePadIndex != null) {
        if (ctx.xyBaseGranular) {
            ctx.xyBaseGranular = { ...ctx.xyBaseGranular, ...p };
        }
        ctx.state.voiceManager?.updateVoiceBaseParams(ctx.state.activePadIndex, p);
    }
}

// Performance optimization: Throttled audio updates during knob dragging
// This separates visual updates (immediate) from audio engine updates (throttled)
let pendingAudioUpdates = new Map<string, { value: number; cfg: KnobConfig }>();
let audioUpdateRaf: number | null = null;

function scheduleAudioUpdate(cfgId: string, value: number, cfg: KnobConfig) {
    pendingAudioUpdates.set(cfgId, { value, cfg });
    
    if (audioUpdateRaf === null) {
        audioUpdateRaf = requestAnimationFrame(() => {
            audioUpdateRaf = null;
            // Apply all pending audio updates in a single batch
            // Only update audio engine and state, skip UI (already updated)
            pendingAudioUpdates.forEach(({ value, cfg }) => {
                applyAudioUpdateOnly(cfg.id, value);
            });
            pendingAudioUpdates.clear();
        });
    }
}

function flushAudioUpdates() {
    if (audioUpdateRaf !== null) {
        cancelAnimationFrame(audioUpdateRaf);
        audioUpdateRaf = null;
    }
    // Apply any remaining updates immediately
    pendingAudioUpdates.forEach(({ value, cfg }) => {
        applyAudioUpdateOnly(cfg.id, value);
    });
    pendingAudioUpdates.clear();
}

// Apply audio update without UI updates (UI is already updated during drag)
function applyAudioUpdateOnly(cfgId: string, value: number) {
    const cfg = knobConfigs.find(k => k.id === cfgId);
    if (!cfg) return;
    
    // Apply value to state and audio engine only, skip UI updates
    // This is a performance optimization to avoid redundant UI work during drag
    switch (cfgId) {
        case 'pitch': {
            const snappedPitch = quantizePitch(Math.round(value), ctx.state.activeScaleIndex);
            const p1: any = { pitchSemitones: snappedPitch };
            updateActiveVoiceGranular(p1);
            if (ctx.state.activePadIndex != null) {
                ctx.state.padParams.setGranular(ctx.state.activePadIndex, p1);
                const pos = ctx.xy.getPosition();
                ctx.host.updateVisualsFromXY(pos.x, pos.y);
            }
            break;
        }
        case 'density':
            const p2: any = { density: Math.round(value) };
            updateActiveVoiceGranular(p2);
            if (ctx.state.activePadIndex != null) ctx.state.padParams.setGranular(ctx.state.activePadIndex, p2);
            ctx.xy.setDensity?.(p2.density, 0);
            break;
        case 'grain': {
            const { region, duration } = activeDurationLimits();
            const p3: any = { grainSizeMs: clampGrainSizeMs(value, region, duration) };
            updateActiveVoiceGranular(p3);
            if (ctx.state.activePadIndex != null) ctx.state.padParams.setGranular(ctx.state.activePadIndex, p3);
            break;
        }
        case 'rand': {
            const { region, duration } = activeDurationLimits();
            const p4: any = { randomStartMs: clampRandomStartMs(value, region, duration) };
            updateActiveVoiceGranular(p4);
            if (ctx.state.activePadIndex != null) ctx.state.padParams.setGranular(ctx.state.activePadIndex, p4);
            break;
        }
        case 'filter':
            const fx1: any = { filterCutoffHz: Math.max(200, Math.round(value)) };
            ctx.host.applyFxToEngine(fx1);
            if (ctx.state.activePadIndex != null) ctx.state.padParams.setEffects(ctx.state.activePadIndex, fx1);
            ctx.xy.setFilterCutoff?.(fx1.filterCutoffHz, 0);
            break;
        case 'res':
            const fx2: any = { filterQ: Math.max(0, Math.min(20, value)) };
            ctx.host.applyFxToEngine(fx2);
            if (ctx.state.activePadIndex != null) ctx.state.padParams.setEffects(ctx.state.activePadIndex, fx2);
            break;
        case 'dtime':
            const fx3: any = { delayTimeSec: Math.max(0, Math.min(1.2, value)) };
            ctx.host.applyFxToEngine(fx3);
            if (ctx.state.activePadIndex != null) ctx.state.padParams.setEffects(ctx.state.activePadIndex, fx3);
            break;
        case 'dmix':
            const fx4: any = { delayMix: Math.max(0, Math.min(1, value)) };
            ctx.host.applyFxToEngine(fx4);
            if (ctx.state.activePadIndex != null) ctx.state.padParams.setEffects(ctx.state.activePadIndex, fx4);
            break;
        case 'reverb':
            const fx5: any = { reverbMix: Math.max(0, Math.min(1, value)) };
            ctx.host.applyFxToEngine(fx5);
            if (ctx.state.activePadIndex != null) ctx.state.padParams.setEffects(ctx.state.activePadIndex, fx5);
            ctx.xy.setReverbMix?.(value);
            break;
        case 'gain':
            const fx6: any = { masterGain: Math.max(0, Math.min(1.5, value)) };
            ctx.host.applyFxToEngine(fx6);
            if (ctx.state.activePadIndex != null) ctx.state.padParams.setEffects(ctx.state.activePadIndex, fx6);
            break;
        default:
            // For other params, use the normal set() method
            cfg.set(value);
            break;
    }
}

const knobConfigs: KnobConfig[] = [
	{
		id: 'pitch', min: -12, max: 12, step: 1,
		get: () => (ctx.state.padParams.get(ctx.state.activePadIndex ?? 0).granular.pitchSemitones),
		set: (v) => {
			const snapped = quantizePitch(Math.round(v), ctx.state.activeScaleIndex);
			const p: any = { pitchSemitones: snapped };
			updateActiveVoiceGranular(p);
			if (ctx.state.activePadIndex != null) ctx.state.padParams.setGranular(ctx.state.activePadIndex, p);
		},
		format: (v) => String(quantizePitch(Math.round(v), ctx.state.activeScaleIndex))
	},
	{
		id: 'density', min: 1, max: 60, step: 1,
		get: () => (ctx.state.padParams.get(ctx.state.activePadIndex ?? 0).granular.density),
		set: (v) => {
			const p: any = { density: Math.round(v) };
			updateActiveVoiceGranular(p);
			if (ctx.state.activePadIndex != null) {
				ctx.state.padParams.setGranular(ctx.state.activePadIndex, p);
				ctx.host.syncMarkerEngine(ctx.state.activePadIndex);
			}
			ctx.xy.setDensity?.(p.density, 0);
		},
		format: (v) => String(Math.round(v))
	},
	{
		id: 'grain', min: GRAIN_SIZE_MIN_MS, max: GRAIN_SIZE_CLASSIC_MAX_MS, step: 1,
		getMin: () => GRAIN_SIZE_MIN_MS,
		getMax: () => grainSizeMaxMs(activeDurationLimits().region, activeDurationLimits().duration),
		toNorm: durationKnobToNorm,
		fromNorm: durationKnobFromNorm,
		get: () => {
			const { region, duration } = activeDurationLimits();
			return clampGrainSizeMs(
				ctx.state.padParams.get(ctx.state.activePadIndex ?? 0).granular.grainSizeMs,
				region,
				duration
			);
		},
		set: (v) => {
			const { region, duration } = activeDurationLimits();
			const p: any = { grainSizeMs: clampGrainSizeMs(v, region, duration) };
			updateActiveVoiceGranular(p);
			if (ctx.state.activePadIndex != null) ctx.state.padParams.setGranular(ctx.state.activePadIndex, p);
		},
		format: (v) => formatDurationMs(v)
	},
	{
		id: 'rand', min: RANDOM_START_MIN_MS, max: GRAIN_SIZE_CLASSIC_MAX_MS, step: 1,
		getMin: () => RANDOM_START_MIN_MS,
		getMax: () => randomStartMaxMs(activeDurationLimits().region, activeDurationLimits().duration),
		toNorm: durationKnobToNorm,
		fromNorm: durationKnobFromNorm,
		get: () => {
			const { region, duration } = activeDurationLimits();
			return clampRandomStartMs(
				ctx.state.padParams.get(ctx.state.activePadIndex ?? 0).granular.randomStartMs,
				region,
				duration
			);
		},
		set: (v) => {
			const { region, duration } = activeDurationLimits();
			const p: any = { randomStartMs: clampRandomStartMs(v, region, duration) };
			updateActiveVoiceGranular(p);
			if (ctx.state.activePadIndex != null) ctx.state.padParams.setGranular(ctx.state.activePadIndex, p);
		},
		format: (v) => formatDurationMs(v)
	},
	{
		id: 'selpos', min: 0, max: 1, step: 0.01,
		get: () => {
			const sel = ctx.waveform.getSelection();
			const buf = ctx.host.activeAudioBuffer();
			if (!sel || !buf) return 0;
			const width = sel.end - sel.start;
			const movable = Math.max(0, buf.duration - width);
			return movable > 0 ? (sel.start / movable) : 0;
		},
		set: (v) => {
			const sel = ctx.waveform.getSelection();
			const buf = ctx.host.activeAudioBuffer();
			if (!sel || !buf) return;
			const width = sel.end - sel.start;
			const movable = Math.max(0, buf.duration - width);
			let newStart = movable * Math.max(0, Math.min(1, v));
			let newEnd = newStart + width;
			if (newEnd > buf.duration) { newEnd = buf.duration; newStart = Math.max(0, newEnd - width); }
			ctx.waveform.setSelection(newStart, newEnd);
			ctx.host.updateSelPosUI();
		},
		format: (v) => String(Math.round(v * 100))
	},
	{
		id: 'filter', min: 200, max: 12000, step: 1,
		get: () => (ctx.state.padParams.get(ctx.state.activePadIndex ?? 0).effects.filterCutoffHz),
		set: (v) => {
			const fx: any = { filterCutoffHz: Math.max(200, Math.round(v)) };
			ctx.host.applyFxToEngine(fx);
			if (ctx.state.activePadIndex != null) ctx.state.padParams.setEffects(ctx.state.activePadIndex, fx);
			// Aggiorna il colore ciano quando cambia il filtro cutoff (peso 0 perché non viene da XYPad)
			ctx.xy.setFilterCutoff?.(fx.filterCutoffHz, 0);
		},
		format: (v) => String(Math.round(v))
	},
	{
		id: 'res', min: 0, max: 20, step: 0.1,
		get: () => (ctx.state.padParams.get(ctx.state.activePadIndex ?? 0).effects.filterQ ?? 0),
		set: (v) => {
			const fx: any = { filterQ: Math.max(0, Math.min(20, v)) };
			ctx.host.applyFxToEngine(fx);
			if (ctx.state.activePadIndex != null) ctx.state.padParams.setEffects(ctx.state.activePadIndex, fx);
		},
		format: (v) => String(Math.round(v))
	},
	{
		id: 'dtime', min: 0, max: 1.2, step: 0.01,
		get: () => (ctx.state.padParams.get(ctx.state.activePadIndex ?? 0).effects.delayTimeSec),
		set: (v) => {
			const fx: any = { delayTimeSec: Math.max(0, Math.min(1.2, v)) };
			if (ctx.state.activePadIndex != null) {
				const bpm = ctx.host.activePadBpm(ctx.state.activePadIndex);
				const sync = ctx.state.padParams.get(ctx.state.activePadIndex).effects.delaySync;
				if (sync) {
					const beats = ctx.host.snapDelayBeats(fx.delayTimeSec, bpm);
					fx.delayTimeSec = ctx.host.delayFromBeats(beats, bpm);
					fx.delaySync = true;
				}
			}
			ctx.host.applyFxToEngine(fx);
			if (ctx.state.activePadIndex != null) ctx.state.padParams.setEffects(ctx.state.activePadIndex, fx);
		},
		format: (v) => {
			if (ctx.state.activePadIndex != null && ctx.state.padParams.get(ctx.state.activePadIndex).effects.delaySync) {
				return ctx.host.formatDelayBeats(ctx.host.snapDelayBeats(v, ctx.host.activePadBpm()));
			}
			return (Math.round(v * 100) / 100).toFixed(2);
		}
	},
	{
		id: 'dmix', min: 0, max: 1, step: 0.01,
		get: () => (ctx.state.padParams.get(ctx.state.activePadIndex ?? 0).effects.delayMix),
		set: (v) => {
			const fx: any = { delayMix: Math.max(0, Math.min(1, v)) };
			ctx.host.applyFxToEngine(fx);
			if (ctx.state.activePadIndex != null) ctx.state.padParams.setEffects(ctx.state.activePadIndex, fx);
		},
		format: (v) => (Math.round(v * 100) / 100).toFixed(2)
	},
	{
		id: 'reverb', min: 0, max: 1, step: 0.01,
		get: () => (ctx.state.padParams.get(ctx.state.activePadIndex ?? 0).effects.reverbMix),
		set: (v) => {
			const fx: any = { reverbMix: Math.max(0, Math.min(1, v)) };
			ctx.host.applyFxToEngine(fx);
			if (ctx.state.activePadIndex != null) ctx.state.padParams.setEffects(ctx.state.activePadIndex, fx);
			// Aggiorna il numero di simboli nell'XYPad in base al riverbero
			ctx.xy.setReverbMix?.(v);
		},
		format: (v) => (Math.round(v * 100) / 100).toFixed(2)
	},
	{
		id: 'gain', min: 0, max: 1.5, step: 0.01,
		get: () => (ctx.state.padParams.get(ctx.state.activePadIndex ?? 0).effects.masterGain),
		set: (v) => {
			const fx: any = { masterGain: Math.max(0, Math.min(1.5, v)) };
			ctx.host.applyFxToEngine(fx);
			if (ctx.state.activePadIndex != null) ctx.state.padParams.setEffects(ctx.state.activePadIndex, fx);
		},
		format: (v) => (Math.round(v * 100) / 100).toFixed(2)
	},
	{
		id: 'xyspeed', min: 0.01, max: 2.0, step: 0.01,
		get: () => {
			if (ctx.state.activePadIndex != null) {
				return ctx.state.padParams.get(ctx.state.activePadIndex).xySpeed ?? 0.15;
			}
			return 0.15;
		},
		set: (v) => {
			const normal = Math.max(0.01, Math.min(2.0, v));
			const shift = knobConfigs.find(k => k.id === 'xyshift')?.get() ?? 0.05;
			ctx.xy.setSpeed?.(normal, shift);
			// Save to pad params
			if (ctx.state.activePadIndex != null) {
				const current = ctx.state.padParams.get(ctx.state.activePadIndex);
				ctx.state.padParams.set(ctx.state.activePadIndex, { xySpeed: normal, xyShift: shift });
			}
		},
		format: (v) => (Math.round(v * 100) / 100).toFixed(2)
	},
	{
		id: 'xyshift', min: 0.01, max: 1.0, step: 0.01,
		get: () => {
			if (ctx.state.activePadIndex != null) {
				return ctx.state.padParams.get(ctx.state.activePadIndex).xyShift ?? 0.05;
			}
			return 0.05;
		},
		set: (v) => {
			const shift = Math.max(0.01, Math.min(1.0, v));
			const normal = knobConfigs.find(k => k.id === 'xyspeed')?.get() ?? 0.15;
			ctx.xy.setSpeed?.(normal, shift);
			// Save to pad params
			if (ctx.state.activePadIndex != null) {
				const current = ctx.state.padParams.get(ctx.state.activePadIndex);
				ctx.state.padParams.set(ctx.state.activePadIndex, { xySpeed: normal, xyShift: shift });
			}
		},
		format: (v) => (Math.round(v * 100) / 100).toFixed(2)
	},
	{
		id: 'motion-speed', min: 0.1, max: 4.0, step: 0.1,
		get: () => {
			const speedInput = document.getElementById('motionSpeed') as HTMLInputElement;
			return speedInput ? parseFloat(speedInput.value) : 1.0;
		},
		set: (v) => {
			const speedInput = document.getElementById('motionSpeed') as HTMLInputElement;
			if (speedInput) speedInput.value = String(Math.max(0.1, Math.min(4.0, v)));
			if (ctx.state.activePadIndex != null) {
				const current = ctx.state.padParams.get(ctx.state.activePadIndex);
				ctx.state.padParams.setMotionParams(ctx.state.activePadIndex, current.motionMode || 'loop', v);
				// Update voice directly without retrigger to preserve manual override state
				if (ctx.state.voiceManager?.isPadPlaying(ctx.state.activePadIndex)) {
					ctx.state.voiceManager.setVoiceMotionSpeed(ctx.state.activePadIndex, v);
				} else {
					// Only trigger if pad is not playing
					ctx.host.triggerPad(ctx.state.activePadIndex);
				}
			}
		},
		format: (v) => (Math.round(v * 10) / 10).toFixed(1)
	},
	{
		id: 'motion-loop', min: 0, max: 3, step: 1,
		get: () => {
			const loopSelect = document.getElementById('motionLoopMode') as HTMLSelectElement;
			if (!loopSelect) return 0;
			const modes = ['loop', 'pingpong', 'oneshot', 'reverse'];
			return modes.indexOf(loopSelect.value);
		},
		set: (v) => {
			const loopSelect = document.getElementById('motionLoopMode') as HTMLSelectElement;
			if (!loopSelect) return;
			const modes = ['loop', 'pingpong', 'oneshot', 'reverse'];
			const idx = Math.max(0, Math.min(3, Math.round(v)));
			loopSelect.value = modes[idx];
			if (ctx.state.activePadIndex != null) {
				const current = ctx.state.padParams.get(ctx.state.activePadIndex);
				ctx.state.padParams.setMotionParams(ctx.state.activePadIndex, modes[idx] as any, current.motionSpeed || 1.0);
				// Update voice directly without retrigger to preserve manual override state
				if (ctx.state.voiceManager?.isPadPlaying(ctx.state.activePadIndex)) {
					ctx.state.voiceManager.setVoiceMotionMode(ctx.state.activePadIndex, modes[idx] as any);
				} else {
					// Only trigger if pad is not playing
					ctx.host.triggerPad(ctx.state.activePadIndex);
				}
			}
			// Update option selector visual
			const selectorEl = document.querySelector('.option-selector[data-selector="motion-loop"]') as HTMLElement | null;
			const labelEl = selectorEl?.querySelector('.option-selector-label[data-label="motion-loop"]') as HTMLElement | null;
			if (labelEl) {
				const labels = ['Loop', 'PingPong', 'OneShot', 'Reverse'];
				labelEl.textContent = labels[idx];
			}
		},
		format: (v) => {
			const modes = ['Loop', 'PingPong', 'OneShot', 'Reverse'];
			return modes[Math.max(0, Math.min(3, Math.round(v)))];
		}
	},
	{
		id: 'zoom', min: 0.1, max: 5.0, step: 0.1,
		get: () => {
			const waveZoomInput = document.getElementById('waveZoom') as HTMLInputElement;
			return waveZoomInput ? parseFloat(waveZoomInput.value) : 1.0;
		},
		set: (v) => {
			const clamped = Math.max(0.1, Math.min(5.0, v));
			ctx.host.updateZoomDisplay(clamped);
		},
		format: (v) => (Math.round(v * 10) / 10).toFixed(1)
	},
	{
		id: 'nudge-step', min: 1, max: 1000, step: 1,
		get: () => {
			const nudgeStepInput = document.getElementById('nudgeStepMs') as HTMLInputElement;
			return nudgeStepInput ? parseInt(nudgeStepInput.value) : 20;
		},
		set: (v) => {
			const nudgeStepInput = document.getElementById('nudgeStepMs') as HTMLInputElement;
			if (nudgeStepInput) nudgeStepInput.value = String(Math.max(1, Math.min(1000, Math.round(v))));
		},
		format: (v) => String(Math.round(v))
	},
	{
		id: 'recall', min: 0, max: 1, step: 1,
		get: () => ctx.state.recallPerPad ? 1 : 0,
		set: (v) => {
			ctx.state.recallPerPad = v >= 0.5;
			ctx.host.markSessionDirty();
		},
		format: (v) => v >= 0.5 ? 'ON' : 'OFF'
	},
	{
		id: 'midi-learn', min: 0, max: 1, step: 1,
		get: () => ctx.state.midi.learnEnabled ? 1 : 0,
		set: (v) => {
			const enabled = v >= 0.5;
			ctx.state.midi.learnEnabled = enabled;
			ctx.state.midi.pendingTarget = null;
			ctx.host.highlightPending(null);
			ctx.host.refreshMarkerUI();
			if (enabled) {
				requestMidiAccess(() => {
					ctx.state.midi.learnEnabled = false;
					ctx.host.refreshMarkerUI();
				});
			}
		},
		format: (v) => v >= 0.5 ? 'ON' : 'OFF'
	},
	{
		id: 'midi-keys', min: 0, max: 1, step: 1,
		get: () => ctx.state.midiMode === 'keys' ? 1 : 0,
		set: (v) => {
			ctx.state.midiMode = v >= 0.5 ? 'keys' : 'pads';
			ctx.heldMidiNotes.length = 0;
			if (ctx.state.midiMode === 'keys') {
				requestMidiAccess(() => {
					ctx.state.midiMode = 'pads';
				});
			}
			ctx.host.markSessionDirty();
		},
		format: (v) => v >= 0.5 ? 'ON' : 'OFF'
	},
	{
		id: 'marker-bpm', min: 40, max: 200, step: 1,
		get: () => ctx.host.getMarkerSeq(ctx.state.activePadIndex ?? 0).bpm,
		set: (v) => {
			if (ctx.state.activePadIndex == null) return;
			ctx.state.padParams.setMarkerSeq(ctx.state.activePadIndex, { bpm: Math.round(Math.max(40, Math.min(200, v))) });
			ctx.host.syncMarkerEngine(ctx.state.activePadIndex);
			ctx.host.applyDelaySyncForPad(ctx.state.activePadIndex);
		},
		format: (v) => String(Math.round(v))
	},
	{
		id: 'marker-chance', min: 0, max: 1, step: 0.01,
		get: () => ctx.host.getMarkerSeq(ctx.state.activePadIndex ?? 0).chance ?? 1,
		set: (v) => {
			if (ctx.state.activePadIndex == null) return;
			ctx.state.padParams.setMarkerSeq(ctx.state.activePadIndex, { chance: Math.max(0, Math.min(1, v)) });
			ctx.host.syncMarkerEngine(ctx.state.activePadIndex);
		},
		format: (v) => `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%`
	},
	{
		id: 'marker-bloom-change', min: 0, max: 1, step: 0.01,
		get: () => ctx.host.getMarkerSeq(ctx.state.activePadIndex ?? 0).bloomChange ?? 1,
		set: (v) => {
			if (ctx.state.activePadIndex == null) return;
			ctx.state.padParams.setMarkerSeq(ctx.state.activePadIndex, { bloomChange: Math.max(0, Math.min(1, v)) });
			ctx.host.syncMarkerEngine(ctx.state.activePadIndex);
		},
		format: (v) => `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%`
	},
	{
		id: 'marker-euclid-hits', min: 1, max: 16, step: 1,
		get: () => ctx.host.getMarkerSeq(ctx.state.activePadIndex ?? 0).euclidHits,
		set: (v) => {
			if (ctx.state.activePadIndex == null) return;
			const seq = ctx.host.getMarkerSeq(ctx.state.activePadIndex);
			const hits = Math.round(Math.max(1, Math.min(seq.euclidSteps, v)));
			ctx.state.padParams.setMarkerSeq(ctx.state.activePadIndex, { euclidHits: hits });
			ctx.host.syncMarkerEngine(ctx.state.activePadIndex);
		},
		format: (v) => String(Math.round(v))
	},
	{
		id: 'marker-euclid-steps', min: 2, max: 16, step: 1,
		get: () => ctx.host.getMarkerSeq(ctx.state.activePadIndex ?? 0).euclidSteps,
		set: (v) => {
			if (ctx.state.activePadIndex == null) return;
			const steps = Math.round(Math.max(2, Math.min(16, v)));
			const seq = ctx.host.getMarkerSeq(ctx.state.activePadIndex);
			ctx.state.padParams.setMarkerSeq(ctx.state.activePadIndex, {
				euclidSteps: steps,
				euclidHits: Math.min(seq.euclidHits, steps)
			});
			ctx.host.syncMarkerEngine(ctx.state.activePadIndex);
		},
		format: (v) => String(Math.round(v))
	},
	{
		id: 'marker-hold', min: 0, max: 8, step: 1,
		get: () => {
			const id = ctx.waveform.getSelectedMarkerId();
			if (!id) return 0;
			const marker = ctx.host.getMarkerSeq(ctx.state.activePadIndex ?? 0).markers.find(m => m.id === id);
			return marker ? markerHold(marker) : 0;
		},
		set: (v) => {
			const id = ctx.waveform.getSelectedMarkerId();
			if (!id || ctx.state.activePadIndex == null) return;
			const seq = setMarkerHold(ctx.host.getMarkerSeq(ctx.state.activePadIndex), id, v);
			ctx.state.padParams.setMarkerSeq(ctx.state.activePadIndex, { markers: seq.markers });
			ctx.waveform.setMarkers(seq.markers);
			ctx.host.syncMarkerEngine(ctx.state.activePadIndex);
		},
		format: (v) => {
			if (!ctx.waveform.getSelectedMarkerId()) return '—';
			return String(Math.round(v));
		}
	},
	{
		id: 'marker-drift', min: 0, max: 400, step: 1,
		get: () => {
			const id = ctx.waveform.getSelectedMarkerId();
			if (!id) return 0;
			const marker = ctx.host.getMarkerSeq(ctx.state.activePadIndex ?? 0).markers.find(m => m.id === id);
			return marker ? markerDriftMs(marker) : 0;
		},
		set: (v) => {
			const id = ctx.waveform.getSelectedMarkerId();
			if (!id || ctx.state.activePadIndex == null) return;
			const seq = setMarkerDrift(ctx.host.getMarkerSeq(ctx.state.activePadIndex), id, { driftMs: v });
			ctx.state.padParams.setMarkerSeq(ctx.state.activePadIndex, { markers: seq.markers });
			ctx.waveform.setMarkers(seq.markers);
			ctx.host.syncMarkerEngine(ctx.state.activePadIndex);
		},
		format: (v) => {
			if (!ctx.waveform.getSelectedMarkerId()) return '—';
			return `${Math.round(v)} ms`;
		}
	},
	{
		id: 'marker-drift-speed', min: 0.03, max: 0.4, step: 0.01,
		get: () => {
			const id = ctx.waveform.getSelectedMarkerId();
			if (!id) return 0.08;
			const marker = ctx.host.getMarkerSeq(ctx.state.activePadIndex ?? 0).markers.find(m => m.id === id);
			return marker ? markerDriftHz(marker) : 0.08;
		},
		set: (v) => {
			const id = ctx.waveform.getSelectedMarkerId();
			if (!id || ctx.state.activePadIndex == null) return;
			const seq = setMarkerDrift(ctx.host.getMarkerSeq(ctx.state.activePadIndex), id, { driftHz: v });
			ctx.state.padParams.setMarkerSeq(ctx.state.activePadIndex, { markers: seq.markers });
			ctx.host.syncMarkerEngine(ctx.state.activePadIndex);
		},
		format: (v) => {
			if (!ctx.waveform.getSelectedMarkerId()) return '—';
			const hz = Math.max(0.03, v);
			return `${(1 / hz).toFixed(1)}s`;
		}
	}
];

function initParamTiles() {
	knobConfigs.forEach(cfg => {
		const knobEl = document.querySelector(`.knob[data-knob="${cfg.id}"]`) as HTMLElement | null;
		const valEl = document.querySelector(`.tile-value[data-val="${cfg.id}"]`) as HTMLElement | null;
		if (!knobEl || !valEl) return;
		if ((knobEl as any).__knobInitialized) return;
		(knobEl as any).__knobInitialized = true;
		// MIDI learn target binding
		(knobEl.closest('.param-tile') as HTMLElement).addEventListener('click', () => {
			if (!isMidiMetaKnob(cfg.id) && ctx.state.midi.learnEnabled) {
				ctx.state.midi.pendingTarget = `knob:${cfg.id}`;
				ctx.host.highlightPending(ctx.state.midi.pendingTarget);
			}
		});
		let current = cfg.get();
		valEl.textContent = cfg.format(current);
		updateKnobAngle(knobEl, current, cfg);
		
		// Check if this is a toggle switch (on/off control)
		const isToggle = knobEl.classList.contains('toggle-switch-knob');
		
		if (isToggle) {
			// Toggle switch: click to toggle, no drag
			const updateToggleState = () => {
				current = cfg.get();
				const isActive = current >= (cfg.max + cfg.min) / 2;
				knobEl.classList.toggle('active', isActive);
				valEl.textContent = cfg.format(current);
			};
			updateToggleState();
			
			knobEl.addEventListener('click', (e) => {
				e.stopPropagation();
				if (!isMidiMetaKnob(cfg.id) && ctx.state.midi.learnEnabled) {
					ctx.state.midi.pendingTarget = `knob:${cfg.id}`;
					ctx.host.highlightPending(ctx.state.midi.pendingTarget);
					return;
				}
				current = cfg.get();
				const newValue = current >= (cfg.max + cfg.min) / 2 ? cfg.min : cfg.max;
				cfg.set(newValue);
				updateToggleState();
				updateValueDisplay(cfg, newValue);
			});
		} else {
			// Regular knob: drag to adjust
			let dragging = false;
			let startY = 0;
			let startVal = current;
			const onDown = (ev: PointerEvent) => {
				ev.preventDefault();
				dragging = true;
				// If MIDI learn is enabled, set this knob as target immediately
				if (ctx.state.midi.learnEnabled) {
					ctx.state.midi.pendingTarget = `knob:${cfg.id}`;
					ctx.host.highlightPending(ctx.state.midi.pendingTarget);
				}
				startY = ev.clientY;
				startVal = current;
				updateValueDisplay(cfg, current);
				(knobEl as any).setPointerCapture?.(ev.pointerId);
			};
			const onMove = (ev: PointerEvent) => {
				if (!dragging) return;
				const dy = startY - ev.clientY; // upward increases value
				const next = knobFromNorm(cfg, knobToNorm(cfg, startVal) + (dy / 1200));
				current = next;
				// Update UI immediately for responsive feel
				valEl.textContent = cfg.format(current);
				updateKnobAngle(knobEl, current, cfg);
				updateValueDisplay(cfg, current);
				// Schedule audio update with throttling (batched via requestAnimationFrame)
				scheduleAudioUpdate(cfg.id, current, cfg);
			};
			const onUp = (ev: PointerEvent) => {
				dragging = false;
				// Flush any pending audio updates immediately when drag ends
				flushAudioUpdates();
				(knobEl as any).releasePointerCapture?.(ev.pointerId);
			};
			knobEl.addEventListener('pointerdown', onDown);
			window.addEventListener('pointermove', onMove);
			window.addEventListener('pointerup', onUp);
		}
	});
}

// Performance optimization: Batch DOM updates for knob fill
let pendingKnobUpdates = new Map<HTMLElement, number>();
let knobUpdateRaf: number | null = null;

function updateKnobAngle(knobEl: HTMLElement, value: number, cfg: KnobConfig) {
	const norm = knobToNorm(cfg, value); // 0..1
	const degrees = -135 + norm * 270; // -135deg to +135deg (270 degree sweep)
	
	let fill = knobEl.querySelector('.knob-fill') as HTMLElement | null;
	if (!fill) {
		fill = document.createElement('div');
		fill.className = 'knob-fill';
		knobEl.appendChild(fill);
	}
	
	// Set CSS variables directly on knob element for responsive CSS rendering
	knobEl.style.setProperty('--knob-percent', String(norm));
	knobEl.style.setProperty('--knob-deg', `${degrees}deg`);
	
	// Batch DOM updates via requestAnimationFrame for smooth performance
	pendingKnobUpdates.set(fill, norm * 100);
	
	if (knobUpdateRaf === null) {
		knobUpdateRaf = requestAnimationFrame(() => {
			knobUpdateRaf = null;
			pendingKnobUpdates.forEach((height, fillEl) => {
				fillEl.style.height = `${height}%`;
			});
			pendingKnobUpdates.clear();
		});
	}
}

// Unified value display box functions
function updateValueDisplay(cfg: KnobConfig, value: number) {
	const box = document.getElementById('valueDisplayBox');
	const labelEl = box?.querySelector('.value-display-label') as HTMLElement | null;
	const valueEl = box?.querySelector('.value-display-value') as HTMLElement | null;
	
	if (!box || !labelEl || !valueEl) return;
	
	const tileEl = document.querySelector(`.param-tile[data-tile="${cfg.id}"]`) as HTMLElement | null;
	const headerEl = tileEl?.querySelector('.tile-header') as HTMLElement | null;
	const label = headerEl?.textContent || cfg.id.toUpperCase();
	const formattedValue = cfg.format(value);
	
	labelEl.textContent = label;
	valueEl.textContent = formattedValue;
}

// Update knobs with explicit values (used when XY pad position changes)
// If a parameter is not provided, it will be read from state (for knobs not mapped to XY corners)
function refreshParamTilesFromValues(granular?: Partial<GranularParams>, effects?: Partial<EffectsParams>, selectionPosUpdate?: number) {
	syncDurationKnobTooltips();
	// Map granular params to knob IDs
	const granularMap: Record<string, keyof GranularParams> = {
		'pitch': 'pitchSemitones',
		'density': 'density',
		'grain': 'grainSizeMs',
		'rand': 'randomStartMs'
	};
	
	// Map effects params to knob IDs
	const effectsMap: Record<string, keyof EffectsParams> = {
		'filter': 'filterCutoffHz',
		'res': 'filterQ',
		'dtime': 'delayTimeSec',
		'dmix': 'delayMix',
		'reverb': 'reverbMix',
		'gain': 'masterGain'
	};
	
	// Update knobs that correspond to granular params
	Object.entries(granularMap).forEach(([knobId, paramKey]) => {
		const cfg = knobConfigs.find(k => k.id === knobId);
		if (!cfg) return;
		const knobEl = document.querySelector(`.knob[data-knob="${knobId}"]`) as HTMLElement | null;
		const valEl = document.querySelector(`.tile-value[data-val="${knobId}"]`) as HTMLElement | null;
		if (!knobEl || !valEl) return;
		
		// Use provided value if available, otherwise read from state
		const value = granular?.[paramKey] != null ? granular[paramKey] : cfg.get();
		const clamped = Math.max(knobMin(cfg), Math.min(knobMax(cfg), value));
		
		valEl.textContent = cfg.format(clamped);
		
		// Update toggle switch state if applicable
		if (knobEl.classList.contains('toggle-switch-knob')) {
			const isActive = clamped >= (cfg.max + cfg.min) / 2;
			knobEl.classList.toggle('active', isActive);
		} else {
			updateKnobAngle(knobEl, clamped, cfg);
		}
	});
	
	// Update knobs that correspond to effects params
	Object.entries(effectsMap).forEach(([knobId, paramKey]) => {
		const cfg = knobConfigs.find(k => k.id === knobId);
		if (!cfg) return;
		const knobEl = document.querySelector(`.knob[data-knob="${knobId}"]`) as HTMLElement | null;
		const valEl = document.querySelector(`.tile-value[data-val="${knobId}"]`) as HTMLElement | null;
		if (!knobEl || !valEl) return;
		
		// Use provided value if available, otherwise read from state
		const raw = effects?.[paramKey];
		const value = typeof raw === 'number' ? raw : cfg.get();
		
		valEl.textContent = cfg.format(value);
		
		// Update toggle switch state if applicable
		if (knobEl.classList.contains('toggle-switch-knob')) {
			const isActive = value >= (cfg.max + cfg.min) / 2;
			knobEl.classList.toggle('active', isActive);
		} else {
			updateKnobAngle(knobEl, value, cfg);
		}
	});

	// Update selection position knob tile if mapped and updated
	if (selectionPosUpdate !== undefined) {
		const cfg = knobConfigs.find(k => k.id === 'selpos');
		if (cfg) {
			const knobEl = document.querySelector(`.knob[data-knob="selpos"]`) as HTMLElement | null;
			const valEl = document.querySelector(`.tile-value[data-val="selpos"]`) as HTMLElement | null;
			if (knobEl && valEl) {
				valEl.textContent = cfg.format(selectionPosUpdate);
				updateKnobAngle(knobEl, selectionPosUpdate, cfg);
			}
		}
	}
}

function refreshDurationKnobs() {
	syncDurationKnobTooltips();
	for (const id of ['grain', 'rand']) {
		const cfg = knobConfigs.find(k => k.id === id);
		if (!cfg) continue;
		const knobEl = document.querySelector(`.knob[data-knob="${id}"]`) as HTMLElement | null;
		const valEl = document.querySelector(`.tile-value[data-val="${id}"]`) as HTMLElement | null;
		if (!knobEl || !valEl) continue;
		const v = cfg.get();
		valEl.textContent = cfg.format(v);
		updateKnobAngle(knobEl, v, cfg);
	}
}

function refreshParamTilesFromState() {
	syncDurationKnobTooltips();
	knobConfigs.forEach(cfg => {
		const knobEl = document.querySelector(`.knob[data-knob="${cfg.id}"]`) as HTMLElement | null;
		const valEl = document.querySelector(`.tile-value[data-val="${cfg.id}"]`) as HTMLElement | null;
		if (!knobEl || !valEl) return;
		const v = cfg.get();
		valEl.textContent = cfg.format(v);
		
		// Update toggle switch state if applicable
		if (knobEl.classList.contains('toggle-switch-knob')) {
			const isActive = v >= (cfg.max + cfg.min) / 2;
			knobEl.classList.toggle('active', isActive);
		} else {
			updateKnobAngle(knobEl, v, cfg);
		}
	});
	// Also refresh new knob types
	const newKnobIds: Array<'motion-speed' | 'zoom' | 'nudge-step'> = [
		'motion-speed', 'zoom', 'nudge-step'
	];
	newKnobIds.forEach(id => {
		const cfg = knobConfigs.find(k => k.id === id);
		if (!cfg) return;
		const knobEl = document.querySelector(`.knob[data-knob="${id}"]`) as HTMLElement | null;
		const valEl = document.querySelector(`.tile-value[data-val="${id}"]`) as HTMLElement | null;
		if (!knobEl || !valEl) return;
		const v = cfg.get();
		valEl.textContent = cfg.format(v);
		
		// Update toggle switch state if applicable
		if (knobEl.classList.contains('toggle-switch-knob')) {
			const isActive = v >= (cfg.max + cfg.min) / 2;
			knobEl.classList.toggle('active', isActive);
		} else {
			updateKnobAngle(knobEl, v, cfg);
		}
	});
}

// Initialize all new knob types (ones not handled by initParamTiles)
function initAllKnobs() {
	// Initialize new knob types that aren't in the main knobConfigs loop
	const newKnobIds: Array<'motion-speed' | 'zoom' | 'nudge-step'> = [
		'motion-speed', 'zoom', 'nudge-step'
	];
	
	newKnobIds.forEach(id => {
		const cfg = knobConfigs.find(k => k.id === id);
		if (!cfg) return;
		const knobEl = document.querySelector(`.knob[data-knob="${id}"]`) as HTMLElement | null;
		const valEl = document.querySelector(`.tile-value[data-val="${id}"]`) as HTMLElement | null;
		if (!knobEl || !valEl) return;
		
		// Skip if already initialized (check for existing listener)
		if ((knobEl as any).__knobInitialized) return;
		(knobEl as any).__knobInitialized = true;
		
		let current = cfg.get();
		valEl.textContent = cfg.format(current);
		
		// Check if this is a toggle switch
		const isToggle = knobEl.classList.contains('toggle-switch-knob');
		
		if (isToggle) {
			// Toggle switch: click to toggle, no drag
			const updateToggleState = () => {
				current = cfg.get();
				const isActive = current >= (cfg.max + cfg.min) / 2;
				knobEl.classList.toggle('active', isActive);
				valEl.textContent = cfg.format(current);
			};
			updateToggleState();
			
			knobEl.addEventListener('click', (e) => {
				e.stopPropagation();
				current = cfg.get();
				const newValue = current >= (cfg.max + cfg.min) / 2 ? cfg.min : cfg.max;
				cfg.set(newValue);
				updateToggleState();
				updateValueDisplay(cfg, newValue);
			});
		} else {
			// Regular knob: drag to adjust
			updateKnobAngle(knobEl, current, cfg);
			
			let dragging = false;
			let startY = 0;
			let startVal = current;
			let currentPointerId: number | null = null;
			const onDown = (ev: PointerEvent) => {
				ev.preventDefault();
				dragging = true;
				startY = ev.clientY;
				startVal = current;
				currentPointerId = ev.pointerId;
				updateValueDisplay(cfg, current);
				(knobEl as any).setPointerCapture?.(ev.pointerId);
			};
			const onMove = (ev: PointerEvent) => {
				if (!dragging) return;
				const dy = startY - ev.clientY;
				current = knobFromNorm(cfg, knobToNorm(cfg, startVal) + (dy / 1200));
				// Update UI immediately for responsive feel
				valEl.textContent = cfg.format(current);
				updateKnobAngle(knobEl, current, cfg);
				updateValueDisplay(cfg, current);
				// Schedule audio update with throttling (batched via requestAnimationFrame)
				scheduleAudioUpdate(cfg.id, current, cfg);
			};
			const onUp = (ev: PointerEvent) => {
				if (!dragging) return;
				dragging = false;
				// Flush any pending audio updates immediately when drag ends
				flushAudioUpdates();
				if (currentPointerId !== null) {
					(knobEl as any).releasePointerCapture?.(currentPointerId);
					currentPointerId = null;
				}
			};
			knobEl.addEventListener('pointerdown', onDown);
			window.addEventListener('pointermove', onMove);
			window.addEventListener('pointerup', onUp);
		}
	});
}

// Initialize button knobs (draw, play, clear, nudge, midi clear, file, recording, theme)
function initButtonKnobs() {
	// Motion buttons
	const motionRecordBtn = document.getElementById('motionRecordBtn') as HTMLButtonElement;
	const motionPlayBtn = document.getElementById('motionPlayBtn') as HTMLButtonElement;
	const nudgeLeftBtn = document.getElementById('nudgeLeft') as HTMLButtonElement;
	const nudgeRightBtn = document.getElementById('nudgeRight') as HTMLButtonElement;
	const fileLabel = document.querySelector('label[for="fileInput"]') as HTMLElement | null;
	const stopRecordBtn = document.getElementById('stopRecordBtn') as HTMLButtonElement;

	function updateButtonFill(btn: HTMLButtonElement, isActive: boolean) {
		const fill = btn.querySelector('.knob-fill') as HTMLElement | null;
		if (fill) {
			fill.style.height = isActive ? '100%' : '0%';
		}
		const valEl = btn.closest('.param-tile')?.querySelector('.tile-value:not([data-val])') as HTMLElement | null;
		if (valEl) {
			valEl.textContent = isActive ? '1' : '0';
		}
	}

	if (motionRecordBtn) {
		motionRecordBtn.addEventListener('click', () => {
			updateButtonFill(motionRecordBtn, true);
			setTimeout(() => updateButtonFill(motionRecordBtn, false), 200);
		});
	}
	if (motionPlayBtn) {
		// Sync button fill with motion panel play state
		const syncPlayButton = () => {
			if (ctx.motionCtrl) {
				const isPlaying = ctx.motionCtrl.isPlaying();
				const fill = motionPlayBtn.querySelector('.knob-fill') as HTMLElement | null;
				const valEl = motionPlayBtn.closest('.param-tile')?.querySelector('.tile-value:not([data-val])') as HTMLElement | null;
				if (fill) fill.style.height = isPlaying ? '100%' : '0%';
				if (valEl) valEl.textContent = isPlaying ? '1' : '0';
			}
		};
		// Sync on click
		motionPlayBtn.addEventListener('click', () => {
			setTimeout(syncPlayButton, 50); // Small delay to let ctx.motionCtrl update
		});
		// Periodic sync (in case state changes externally)
		setInterval(syncPlayButton, 200);
	}
	if (nudgeLeftBtn) {
		nudgeLeftBtn.addEventListener('mousedown', () => updateButtonFill(nudgeLeftBtn, true));
		nudgeLeftBtn.addEventListener('mouseup', () => updateButtonFill(nudgeLeftBtn, false));
		nudgeLeftBtn.addEventListener('mouseleave', () => updateButtonFill(nudgeLeftBtn, false));
	}
	if (nudgeRightBtn) {
		nudgeRightBtn.addEventListener('mousedown', () => updateButtonFill(nudgeRightBtn, true));
		nudgeRightBtn.addEventListener('mouseup', () => updateButtonFill(nudgeRightBtn, false));
		nudgeRightBtn.addEventListener('mouseleave', () => updateButtonFill(nudgeRightBtn, false));
	}
	if (fileLabel) {
		fileLabel.addEventListener('click', () => {
			updateButtonFill(fileLabel as any, true);
			setTimeout(() => updateButtonFill(fileLabel as any, false), 200);
		});
	}
	if (stopRecordBtn) {
		stopRecordBtn.addEventListener('click', () => {
			updateButtonFill(stopRecordBtn, true);
			setTimeout(() => updateButtonFill(stopRecordBtn, false), 200);
		});
	}
	// Theme button fill is handled in theme toggle handler above
	// Set initial theme button state
	if (ctx.themeToggleBtn) {
		const initialTheme = ctx.themeManager.getTheme();
		const fill = ctx.themeToggleBtn.querySelector('.knob-fill') as HTMLElement | null;
		const valEl = ctx.themeToggleBtn.closest('.param-tile')?.querySelector('.tile-value:not([data-val])') as HTMLElement | null;
		if (fill) fill.style.height = initialTheme === 'dark' ? '100%' : '0%';
		if (valEl) valEl.textContent = initialTheme === 'dark' ? '1' : '0';
	}
}

	return {
		configs: knobConfigs,
		findConfig: (id) => knobConfigs.find(k => k.id === id),
		refreshFromState: refreshParamTilesFromState,
		refreshFromValues: refreshParamTilesFromValues,
		refreshDurationKnobs,
		updateKnobAngle,
		updateValueDisplay,
		init: () => {
			initParamTiles();
			initAllKnobs();
			initButtonKnobs();
		},
		initButtonKnobs
	};
}
