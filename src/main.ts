import { createAudioContextManager } from './modules/audio/AudioContextManager';
import { loadAudioBuffer } from './modules/utils/audioLoader';
import { createRegionStore, type Region } from './modules/editor/RegionStore';
import { createEffectsChain, type EffectsChain } from './modules/effects/EffectsChain';
import { createGranularWorkletEngine, type GranularWorkletEngine } from './modules/granular/GranularWorkletEngine';
import { createPadGrid } from './modules/ui/PadGrid';
import { setupControls } from './modules/ui/Controls';
import { createWaveformView } from './modules/ui/WaveformView';
import { createXYPadThree } from './modules/ui/XYPadThree';
import { PARAMS, type ParamId } from './modules/ui/ParamRegistry';
import { MidiManager, type MidiMapping, loadMappings, saveMappings } from './modules/midi/MidiManager';
import { createPadParamStore } from './modules/editor/PadParamStore';
import type { GranularParams } from './modules/granular/GranularWorkletEngine';
import type { EffectsParams } from './modules/effects/EffectsChain';

type AppState = {
	contextMgr: ReturnType<typeof createAudioContextManager>;
	buffer: AudioBuffer | null;
	effects: EffectsChain | null;
	engine: GranularWorkletEngine | null;
	regions: ReturnType<typeof createRegionStore>;
	activePadIndex: number | null;
	padParams: ReturnType<typeof createPadParamStore>;
	recallPerPad: boolean;
	midi: {
		manager: MidiManager | null;
		mappings: MidiMapping[];
		learnEnabled: boolean;
		pendingTarget: string | null;
	};
};

const state: AppState = {
	contextMgr: createAudioContextManager(),
	buffer: null,
	effects: null,
	engine: null,
	regions: createRegionStore(8),
	activePadIndex: null,
	padParams: createPadParamStore(8),
	recallPerPad: true,
	midi: { manager: null, mappings: loadMappings(), learnEnabled: false, pendingTarget: null }
};

const fileInput = document.getElementById('fileInput') as HTMLInputElement;
const unlockBtn = document.getElementById('unlockBtn') as HTMLButtonElement;
const padGridEl = document.getElementById('padGrid') as HTMLDivElement;
const waveformCanvas = document.getElementById('waveform') as HTMLCanvasElement;
const selStartEl = document.getElementById('selStart') as HTMLElement;
const selEndEl = document.getElementById('selEnd') as HTMLElement;
const bufferDurEl = document.getElementById('bufferDur') as HTMLElement;
const clearSelectionBtn = document.getElementById('clearSelectionBtn') as HTMLButtonElement;
const nudgeLeftBtn = document.getElementById('nudgeLeft') as HTMLButtonElement;
const nudgeRightBtn = document.getElementById('nudgeRight') as HTMLButtonElement;
const nudgeStepInput = document.getElementById('nudgeStepMs') as HTMLInputElement;
const waveform = createWaveformView(waveformCanvas);
const recallPerPadEl = document.getElementById('recallPerPad') as HTMLInputElement;
const midiLearnEl = document.getElementById('midiLearn') as HTMLInputElement | null;
const midiClearBtn = document.getElementById('midiClear') as HTMLButtonElement | null;
const xyCanvas = document.getElementById('xyPad') as HTMLCanvasElement;
const xy = createXYPadThree(xyCanvas);
const xyModeParamsBtn = document.getElementById('xyModeParams') as HTMLButtonElement | null;
const xyModePadsBtn = document.getElementById('xyModePads') as HTMLButtonElement | null;
const cornerTL = document.getElementById('xyCornerTL') as HTMLSelectElement;
const cornerTR = document.getElementById('xyCornerTR') as HTMLSelectElement;
const cornerBL = document.getElementById('xyCornerBL') as HTMLSelectElement;
const cornerBR = document.getElementById('xyCornerBR') as HTMLSelectElement;
// Helper to get current XY mode
let currentXYMode: 'params' | 'pads' = 'params';
function getXYMode(): 'params' | 'pads' {
	return currentXYMode;
}
function setXYMode(mode: 'params' | 'pads') {
	currentXYMode = mode;
	// Update button states
	if (xyModeParamsBtn && xyModePadsBtn) {
		if (mode === 'params') {
			xyModeParamsBtn.classList.add('active');
			xyModePadsBtn.classList.remove('active');
		} else {
			xyModeParamsBtn.classList.remove('active');
			xyModePadsBtn.classList.add('active');
		}
	}
}
// Flag to prevent saving selection to pad during XY morphing
let isXYMorphing = false;
waveform.onSelection((sel) => {
	if (sel) {
		selStartEl.textContent = sel.start.toFixed(2);
		selEndEl.textContent = sel.end.toFixed(2);
		updateSelPosUI();
		// Persist selection to active pad as its region (non-destructive: preserve name)
		// BUT NOT during XY pad morphing (would interfere with morphing)
		if (state.activePadIndex != null && !isXYMorphing) {
			const existing = state.regions.get(state.activePadIndex);
			state.regions.set(state.activePadIndex, { start: sel.start, end: sel.end, name: existing?.name });
			updatePadGrid();
		}
		// Update engine region in real-time
		if (state.engine && state.buffer) {
			state.engine.setRegion(sel.start, sel.end);
			// ensure immediate response while dragging
			state.engine.trigger();
		}
	} else {
		selStartEl.textContent = '0.00';
		selEndEl.textContent = '0.00';
		updateSelPosUI();
	}
});

unlockBtn.addEventListener('click', async () => {
	await state.contextMgr.unlock();
	unlockBtn.textContent = 'Audio Sbloccato';
});

if (recallPerPadEl) {
	recallPerPadEl.checked = true;
	recallPerPadEl.addEventListener('change', () => {
		state.recallPerPad = recallPerPadEl.checked;
	});
}

if (clearSelectionBtn) {
	clearSelectionBtn.addEventListener('click', () => {
		// clear waveform selection and remove region for active pad
		waveform.clearSelection();
		if (state.activePadIndex != null) {
			state.regions.set(state.activePadIndex, null as any);
			updatePadGrid();
			// Update XY pad dropdowns if in pad mode
			if (getXYMode() === 'pads') {
				populateParamSelect(cornerTL);
				populateParamSelect(cornerTR);
				populateParamSelect(cornerBL);
				populateParamSelect(cornerBR);
				refreshXYCornerLabels();
			}
		}
	});
}

// ---------- MIDI ----------
async function initMIDI(): Promise<boolean> {
	state.midi.manager = new MidiManager();
	const ok = await state.midi.manager.init();
	if (!ok) return false;
	state.midi.manager.on((e) => {
		if (e.type === 'cc') {
			if (state.midi.learnEnabled && state.midi.pendingTarget) {
				state.midi.mappings = state.midi.mappings.filter(m => m.targetId !== state.midi.pendingTarget);
				state.midi.mappings.push({ type: 'cc', channel: e.channel, controller: e.num, targetId: state.midi.pendingTarget });
				saveMappings(state.midi.mappings);
				state.midi.pendingTarget = null;
				highlightPending(null);
				return;
			}
			const mapping = state.midi.mappings.find(m => m.type === 'cc' && m.channel === e.channel && m.controller === e.num);
			if (mapping) {
				const norm = Math.max(0, Math.min(1, e.value / 127));
				applyMidiToTarget(mapping.targetId, norm);
			}
		} else if (e.type === 'noteon') {
			const mapping = state.midi.mappings.find(m => m.type === 'note' && m.channel === e.channel && m.controller === e.num);
			if (mapping && mapping.targetId.startsWith('pad:')) {
				const index = Number(mapping.targetId.split(':')[1]);
				const region = state.regions.get(index);
				if (region && state.buffer) triggerRegion(region);
			} else if (state.midi.learnEnabled && state.midi.pendingTarget?.startsWith('pad:')) {
				state.midi.mappings = state.midi.mappings.filter(m => m.targetId !== state.midi.pendingTarget);
				state.midi.mappings.push({ type: 'note', channel: e.channel, controller: e.num, targetId: state.midi.pendingTarget });
				saveMappings(state.midi.mappings);
				state.midi.pendingTarget = null;
				highlightPending(null);
			}
		}
	});
	return true;
}

function applyMidiToTarget(targetId: string, norm: number) {
	if (targetId.startsWith('knob:')) {
		const id = targetId.slice(5);
		const cfg = knobConfigs.find(k => k.id === (id as any));
		if (!cfg) return;
		const value = cfg.min + norm * (cfg.max - cfg.min);
		cfg.set(value);
		const knobEl = document.querySelector(`.knob[data-knob="${cfg.id}"]`) as HTMLElement | null;
		const valEl = document.querySelector(`.tile-value[data-val="${cfg.id}"]`) as HTMLElement | null;
		if (knobEl) updateKnobAngle(knobEl, value, cfg);
		if (valEl) valEl.textContent = cfg.format(value);
	}
}

function highlightPending(target: string | null) {
	document.querySelectorAll('.param-tile').forEach(el => el.classList.remove('learn-pending'));
	document.querySelectorAll('.pad').forEach(el => el.classList.remove('learn-pending'));
	if (!target) return;
	if (target.startsWith('knob:')) {
		const id = target.slice(5);
		const tile = document.querySelector(`.param-tile [data-knob="${id}"]`)?.closest('.param-tile') as HTMLElement | null;
		tile?.classList.add('learn-pending');
	} else if (target.startsWith('pad:')) {
		const idx = Number(target.split(':')[1]);
		const pad = document.querySelector(`.pad-grid .pad:nth-child(${idx + 1})`) as HTMLElement | null;
		pad?.classList.add('learn-pending');
	}
}

if (midiLearnEl) {
	midiLearnEl.addEventListener('change', async () => {
		state.midi.learnEnabled = midiLearnEl.checked;
		state.midi.pendingTarget = null;
		highlightPending(null);
		// Lazy-init MIDI on first enable to ensure permission prompt is user-gestured
		if (state.midi.learnEnabled && !state.midi.manager) {
			const ok = await initMIDI();
			if (!ok) {
				console.warn('Web MIDI non disponibile o permesso non concesso.');
				alert('Impossibile attivare il MIDI. Controlla il permesso del browser e riprova (Chrome/Edge).');
				midiLearnEl.checked = false;
				state.midi.learnEnabled = false;
			}
		}
	});
}
if (midiClearBtn) {
	midiClearBtn.addEventListener('click', () => {
		state.midi.mappings = [];
		saveMappings(state.midi.mappings);
	});
}

function nudgeSelection(deltaSec: number) {
	const sel = waveform.getSelection();
	if (!sel || !state.buffer) return;
	const width = sel.end - sel.start;
	let newStart = sel.start + deltaSec;
	let newEnd = newStart + width;
	// clamp within buffer
	if (newStart < 0) {
		newEnd -= newStart;
		newStart = 0;
	}
	if (newEnd > state.buffer.duration) {
		const overflow = newEnd - state.buffer.duration;
		newStart -= overflow;
		newEnd = state.buffer.duration;
	}
	waveform.setSelection(newStart, newEnd); // triggers onSelection → store + engine update
}

function setupNudgeButton(btn: HTMLButtonElement, direction: -1 | 1) {
	if (!btn) return;
	let timer: number | null = null;
	const start = () => {
		const stepMs = Math.max(1, Math.min(1000, Number(nudgeStepInput?.value || 20)));
		const delta = (stepMs / 1000) * direction;
		nudgeSelection(delta);
		timer = window.setInterval(() => nudgeSelection(delta), 120) as any as number;
	};
	const stop = () => {
		if (timer != null) { clearInterval(timer); timer = null; }
	};
	btn.addEventListener('mousedown', start);
	btn.addEventListener('touchstart', (e) => { e.preventDefault(); start(); }, { passive: false });
	window.addEventListener('mouseup', stop);
	window.addEventListener('touchend', stop);
}

setupNudgeButton(nudgeLeftBtn, -1);
setupNudgeButton(nudgeRightBtn, 1);

function updateSelPosUI() {
	const sel = waveform.getSelection();
	const knobEl = document.querySelector('.knob[data-knob="selpos"]') as HTMLElement | null;
	const valEl = document.querySelector('.tile-value[data-val="selpos"]') as HTMLElement | null;
	if (!sel || !state.buffer) {
		if (valEl) valEl.textContent = '0';
		if (knobEl) {
			const cfg = knobConfigs.find(k => k.id === 'selpos')!;
			updateKnobAngle(knobEl, 0, cfg);
		}
		return;
	}
	const width = sel.end - sel.start;
	const movable = Math.max(0, state.buffer.duration - width);
	const pos = movable > 0 ? (sel.start / movable) : 0;
	const percent = Math.round(pos * 100);
	if (valEl) valEl.textContent = String(percent);
	if (knobEl) {
		const cfg = knobConfigs.find(k => k.id === 'selpos')!;
		updateKnobAngle(knobEl, pos, cfg);
	}
}

fileInput.addEventListener('change', async (e) => {
	const file = (e.target as HTMLInputElement).files?.[0];
	if (!file) return;
	await ensureAudioReady();
	const fileNameEl = document.getElementById('fileName');
	if (fileNameEl) fileNameEl.textContent = file.name;
	const arrayBuffer = await file.arrayBuffer();
	const audioBuffer = await loadAudioBuffer(state.contextMgr.audioContext, arrayBuffer);
	state.buffer = audioBuffer;
	ensureEngine();
	ensureEffects();
	updatePadGrid();
	waveform.setBuffer(audioBuffer);
	bufferDurEl.textContent = `Durata: ${audioBuffer.duration.toFixed(2)}s`;
	updateSelPosUI();
	if (state.engine) {
		await state.engine.setBuffer(audioBuffer);
		state.engine.setRegion(0, audioBuffer.duration);
	}
});

function ensureAudioReady() {
	return state.contextMgr.unlock();
}

function ensureEngine() {
	if (!state.engine) {
		// init worklet engine asynchronously
		createGranularWorkletEngine(state.contextMgr.audioContext).then((eng) => {
			state.engine = eng;
			ensureEffects();
			state.engine?.connect(state.effects!.input);
			if (state.buffer) {
				state.engine.setBuffer(state.buffer);
				state.engine.setRegion(0, state.buffer.duration);
			}
		}).catch((err) => {
			console.error('Errore Worklet:', err);
		});
	}
}

function ensureEffects() {
	if (!state.effects) {
		state.effects = createEffectsChain(state.contextMgr.audioContext);
		state.engine?.connect(state.effects.input);
		state.effects.output.connect(state.contextMgr.audioContext.destination);
	}
}

const PAD_COLORS = ['#A1E34B', '#66D9EF', '#FDBC40', '#FF7AA2', '#7C4DFF', '#00E5A8', '#F06292', '#FFD54F'];

function updatePadGrid() {
	padGridEl.innerHTML = '';
	const padGrid = createPadGrid(padGridEl, state.regions.getAll(), { colors: PAD_COLORS, activeIndex: state.activePadIndex });
	padGrid.onPadPress = (index) => {
		if (state.midi?.learnEnabled) {
			state.midi.pendingTarget = `pad:${index}`;
			highlightPending(state.midi.pendingTarget);
			return;
		}
		state.activePadIndex = index;
		snapshotBaseFromCurrentPad();
		// recall pad parameters smoothly before triggering (if enabled)
		if (state.recallPerPad) {
			recallPadParams(index, 300);
		}
		// colorize waveform selection based on pad
		const c = PAD_COLORS[index % PAD_COLORS.length];
		waveform.setColor(c, hexToRgba(c, 0.18));
		// recall waveform selection for this pad
		recallWaveformSelection(index);
	updateSelPosUI();
		const region = state.regions.get(index);
		if (!region || !state.buffer) return;
		triggerRegion(region);
	};
	padGrid.onPadLongPress = (index) => {
		if (state.midi?.learnEnabled) {
			state.midi.pendingTarget = `pad:${index}`;
			highlightPending(state.midi.pendingTarget);
			return;
		}
		state.activePadIndex = index;
		snapshotBaseFromCurrentPad();
		// recall when selecting too (if enabled), so tweaks you do next apply to this pad's baseline
		if (state.recallPerPad) {
			recallPadParams(index, 300);
		}
		// colorize waveform for this pad
		const c = PAD_COLORS[index % PAD_COLORS.length];
		waveform.setColor(c, hexToRgba(c, 0.18));
		// recall waveform selection for this pad as visual feedback
		// IMPORTANT: Only recall if pad has saved region, otherwise preserve current selection
		const existingRegion = state.regions.get(index);
		if (existingRegion) {
			recallWaveformSelection(index);
		}
		updateSelPosUI();
		if (!state.buffer) return;
		// assign current waveform selection
		const sel = waveform.getSelection();
		if (sel) {
			const name = prompt('Nome (opzionale):', state.regions.get(index)?.name ?? '') ?? '';
			const region = { start: sel.start, end: sel.end, name: name || undefined };
			state.regions.set(index, region);
			// ensure waveform reflects what we just assigned
			waveform.setSelection(region.start, region.end);
		}
		updatePadGrid();
			// Update XY pad dropdowns if in pad mode
			if (getXYMode() === 'pads') {
			populateParamSelect(cornerTL);
			populateParamSelect(cornerTR);
			populateParamSelect(cornerBL);
			populateParamSelect(cornerBR);
			refreshXYCornerLabels();
		}
	};
}

async function triggerRegion(region: Region) {
	if (!state.buffer || !state.engine) return;
	await state.engine.setBuffer(state.buffer);
	state.engine.setRegion(region.start, region.end);
	state.engine.trigger();
}

const controls = setupControls({
	onParams: (params) => {
		ensureEngine();
		// persist to active pad
		if (state.activePadIndex != null) {
			state.padParams.setGranular(state.activePadIndex, params as GranularParams);
		}
		state.engine?.setParams(params);
	},
	onFX: (fx) => {
		ensureEffects();
		if (!state.effects) return;
		// persist to active pad
		if (state.activePadIndex != null) {
			state.padParams.setEffects(state.activePadIndex, fx as EffectsParams);
		}
		state.effects.setParams(fx);
	}
});

// Initial render
updatePadGrid();

// Smoothly recall parameters for a pad and move UI controls
let recallTimer: number | null = null;
function recallPadParams(index: number, durationMs = 300) {
	const target = state.padParams.get(index);
	if (!target) return;
	// cancel any ongoing transition
	if (recallTimer != null) { clearInterval(recallTimer); recallTimer = null; }
	const steps = Math.max(1, Math.floor(durationMs / 16));
	let step = 0;
	// Read current from active pad state (robust even if sliders are not present)
	const currentPad = state.padParams.get(state.activePadIndex ?? index);
	const fromG = currentPad.granular;
	const fromFx = currentPad.effects;
	const toG = target.granular;
	const toFx = target.effects;
	// ensure UI reflects start
	controls.setGranularUI(fromG);
	controls.setFxUI(fromFx);
	refreshParamTilesFromState();
	recallTimer = setInterval(() => {
		step++;
		const t = step / steps;
		const interpG: GranularParams = {
			grainSizeMs: fromG.grainSizeMs + (toG.grainSizeMs - fromG.grainSizeMs) * t,
			density: fromG.density + (toG.density - fromG.density) * t,
			randomStartMs: fromG.randomStartMs + (toG.randomStartMs - fromG.randomStartMs) * t,
			pitchSemitones: fromG.pitchSemitones + (toG.pitchSemitones - fromG.pitchSemitones) * t
		};
		const interpFx: EffectsParams = {
			filterCutoffHz: fromFx.filterCutoffHz + (toFx.filterCutoffHz - fromFx.filterCutoffHz) * t,
			delayTimeSec: fromFx.delayTimeSec + (toFx.delayTimeSec - fromFx.delayTimeSec) * t,
			delayMix: fromFx.delayMix + (toFx.delayMix - fromFx.delayMix) * t,
			reverbMix: fromFx.reverbMix + (toFx.reverbMix - fromFx.reverbMix) * t,
			masterGain: fromFx.masterGain + (toFx.masterGain - fromFx.masterGain) * t
		};
		// engine/effects
		state.engine?.setParams(interpG);
		state.effects?.setParams(interpFx);
		// UI
		controls.setGranularUI(interpG);
		controls.setFxUI(interpFx);
		refreshParamTilesFromState();
		if (step >= steps) {
			clearInterval(recallTimer!);
			recallTimer = null;
		}
	}, 16) as any as number;
}

function hexToRgba(hex: string, alpha = 1): string {
	const m = hex.replace('#', '');
	const bigint = parseInt(m.length === 3 ? m.split('').map((c) => c + c).join('') : m, 16);
	const r = (bigint >> 16) & 255;
	const g = (bigint >> 8) & 255;
	const b = bigint & 255;
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
	const m = hex.replace('#', '');
	const bigint = parseInt(m.length === 3 ? m.split('').map((c) => c + c).join('') : m, 16);
	return {
		r: (bigint >> 16) & 255,
		g: (bigint >> 8) & 255,
		b: bigint & 255
	};
}

function rgbToHex(r: number, g: number, b: number): string {
	return `#${[r, g, b].map(x => {
		const hex = Math.round(x).toString(16);
		return hex.length === 1 ? '0' + hex : hex;
	}).join('')}`;
}

function interpolateColors(colors: string[], weights: number[]): string {
	if (colors.length !== weights.length || colors.length === 0) return colors[0] || '#000000';
	let r = 0, g = 0, b = 0;
	for (let i = 0; i < colors.length; i++) {
		const rgb = hexToRgb(colors[i]);
		r += rgb.r * weights[i];
		g += rgb.g * weights[i];
		b += rgb.b * weights[i];
	}
	return rgbToHex(r, g, b);
}

function recallWaveformSelection(index: number) {
	const r = state.regions.get(index);
	if (r && state.buffer) {
		waveform.setSelection(r.start, r.end);
	} else {
		waveform.clearSelection();
	}
}

// ---------- XY Pad wiring ----------
function populateParamSelect(select: HTMLSelectElement) {
	const currentValue = select.value; // Save current selection
	select.innerHTML = '';
	const mode = getXYMode();
	if (mode === 'pads') {
		// Show only pads that have a saved region
		const padCount = state.regions.getAll().length;
		const savedPadIndices: number[] = [];
		for (let i = 0; i < padCount; i++) {
			const r = state.regions.get(i);
			if (r) { // Only add pads with saved regions
				const opt = document.createElement('option');
				opt.value = `pad:${i}`;
				const name = r.name ? ` – ${r.name}` : '';
				opt.textContent = `Pad ${i + 1}${name}`;
				select.appendChild(opt);
				savedPadIndices.push(i);
			}
		}
		// If current value is no longer valid, set to first available pad
		if (currentValue && !savedPadIndices.some(idx => `pad:${idx}` === currentValue)) {
			if (savedPadIndices.length > 0) {
				select.value = `pad:${savedPadIndices[0]}`;
			}
		}
	} else {
		for (const p of PARAMS) {
			const opt = document.createElement('option');
			opt.value = p.id;
			opt.textContent = p.label;
			select.appendChild(opt);
		}
		// Restore previous value if it exists
		if (currentValue && Array.from(select.options).some(opt => opt.value === currentValue)) {
			select.value = currentValue;
		}
	}
}
populateParamSelect(cornerTL);
populateParamSelect(cornerTR);
populateParamSelect(cornerBL);
populateParamSelect(cornerBR);
// defaults
cornerTL.value = 'filterCutoffHz';
cornerTR.value = 'density';
cornerBL.value = 'reverbMix';
cornerBR.value = 'pitchSemitones';

let xyBaseGranular: GranularParams | null = null;
let xyBaseFx: EffectsParams | null = null;
let xyBaseSelectionPos: number | null = null; // 0..1 normalized along movable range

function refreshXYCornerLabels() {
	const mode = getXYMode();
	if (mode === 'pads') {
		const label = (v: string) => {
			const idx = Number(v.split(':')[1] ?? '0') || 0;
			const r = state.regions.get(idx);
			return r?.name ? `Pad ${idx + 1} – ${r.name}` : `Pad ${idx + 1}`;
		};
		xy.setCornerLabels({
			tl: label(cornerTL.value),
			tr: label(cornerTR.value),
			bl: label(cornerBL.value),
			br: label(cornerBR.value)
		});
	} else {
		const label = (id: string) => PARAMS.find(p => p.id === (id as ParamId))?.label ?? '';
		xy.setCornerLabels({
			tl: label(cornerTL.value),
			tr: label(cornerTR.value),
			bl: label(cornerBL.value),
			br: label(cornerBR.value)
		});
	}
}
cornerTL.addEventListener('change', refreshXYCornerLabels);
cornerTR.addEventListener('change', refreshXYCornerLabels);
cornerBL.addEventListener('change', refreshXYCornerLabels);
cornerBR.addEventListener('change', refreshXYCornerLabels);
refreshXYCornerLabels();
// react to mode changes
function handleXYModeChange(mode: 'params' | 'pads') {
	setXYMode(mode);
	populateParamSelect(cornerTL);
	populateParamSelect(cornerTR);
	populateParamSelect(cornerBL);
	populateParamSelect(cornerBR);
	if (mode === 'pads') {
		// Find first 4 saved pads and use them as defaults
		const savedPads: number[] = [];
		const padCount = state.regions.getAll().length;
		for (let i = 0; i < padCount && savedPads.length < 4; i++) {
			if (state.regions.get(i)) {
				savedPads.push(i);
			}
		}
		// Set defaults, repeating last pad if needed
		const defaults = [
			savedPads[0] ?? savedPads[savedPads.length - 1] ?? 0,
			savedPads[1] ?? savedPads[savedPads.length - 1] ?? 0,
			savedPads[2] ?? savedPads[savedPads.length - 1] ?? 0,
			savedPads[3] ?? savedPads[savedPads.length - 1] ?? 0
		];
		cornerTL.value = `pad:${defaults[0]}`;
		cornerTR.value = `pad:${defaults[1]}`;
		cornerBL.value = `pad:${defaults[2]}`;
		cornerBR.value = `pad:${defaults[3]}`;
	} else {
		cornerTL.value = 'filterCutoffHz';
		cornerTR.value = 'density';
		cornerBL.value = 'reverbMix';
		cornerBR.value = 'pitchSemitones';
	}
	refreshXYCornerLabels();
}
xyModeParamsBtn?.addEventListener('click', () => handleXYModeChange('params'));
xyModePadsBtn?.addEventListener('click', () => handleXYModeChange('pads'));
// Initialize default mode (params)
setXYMode('params');

// ---------- Param tiles (knobs) ----------
type KnobConfig = {
	id: 'pitch' | 'density' | 'grain' | 'rand' | 'selpos' | 'filter' | 'res' | 'dtime' | 'dmix' | 'reverb' | 'gain';
	min: number; max: number; step: number;
	get: () => number;
	set: (v: number) => void;
	format: (v: number) => string;
};

const knobConfigs: KnobConfig[] = [
	{
		id: 'pitch', min: -12, max: 12, step: 1,
		get: () => (state.padParams.get(state.activePadIndex ?? 0).granular.pitchSemitones),
		set: (v) => {
			const p: any = { pitchSemitones: Math.round(v) };
			state.engine?.setParams(p);
			if (state.activePadIndex != null) state.padParams.setGranular(state.activePadIndex, p);
			controls.setGranularUI(p);
		},
		format: (v) => String(Math.round(v))
	},
	{
		id: 'density', min: 1, max: 60, step: 1,
		get: () => (state.padParams.get(state.activePadIndex ?? 0).granular.density),
		set: (v) => {
			const p: any = { density: Math.round(v) };
			state.engine?.setParams(p);
			if (state.activePadIndex != null) state.padParams.setGranular(state.activePadIndex, p);
			controls.setGranularUI(p);
		},
		format: (v) => String(Math.round(v))
	},
	{
		id: 'grain', min: 10, max: 200, step: 1,
		get: () => (state.padParams.get(state.activePadIndex ?? 0).granular.grainSizeMs),
		set: (v) => {
			const p: any = { grainSizeMs: Math.round(v) };
			state.engine?.setParams(p);
			if (state.activePadIndex != null) state.padParams.setGranular(state.activePadIndex, p);
			controls.setGranularUI(p);
		},
		format: (v) => String(Math.round(v))
	},
	{
		id: 'rand', min: 0, max: 200, step: 1,
		get: () => (state.padParams.get(state.activePadIndex ?? 0).granular.randomStartMs),
		set: (v) => {
			const p: any = { randomStartMs: Math.round(v) };
			state.engine?.setParams(p);
			if (state.activePadIndex != null) state.padParams.setGranular(state.activePadIndex, p);
			controls.setGranularUI(p);
		},
		format: (v) => String(Math.round(v))
	},
	{
		id: 'selpos', min: 0, max: 1, step: 0.01,
		get: () => {
			const sel = waveform.getSelection();
			if (!sel || !state.buffer) return 0;
			const width = sel.end - sel.start;
			const movable = Math.max(0, state.buffer.duration - width);
			return movable > 0 ? (sel.start / movable) : 0;
		},
		set: (v) => {
			const sel = waveform.getSelection();
			if (!sel || !state.buffer) return;
			const width = sel.end - sel.start;
			const movable = Math.max(0, state.buffer.duration - width);
			let newStart = movable * Math.max(0, Math.min(1, v));
			let newEnd = newStart + width;
			if (newEnd > state.buffer.duration) { newEnd = state.buffer.duration; newStart = Math.max(0, newEnd - width); }
			waveform.setSelection(newStart, newEnd);
			updateSelPosUI();
		},
		format: (v) => String(Math.round(v * 100))
	},
	{
		id: 'filter', min: 200, max: 12000, step: 1,
		get: () => (state.padParams.get(state.activePadIndex ?? 0).effects.filterCutoffHz),
		set: (v) => {
			const fx: any = { filterCutoffHz: Math.max(200, Math.round(v)) };
			state.effects?.setParams(fx);
			if (state.activePadIndex != null) state.padParams.setEffects(state.activePadIndex, fx);
			controls.setFxUI(fx);
		},
		format: (v) => String(Math.round(v))
	},
	{
		id: 'res', min: 0, max: 20, step: 0.1,
		get: () => (state.padParams.get(state.activePadIndex ?? 0).effects.filterQ ?? 0),
		set: (v) => {
			const fx: any = { filterQ: Math.max(0, Math.min(20, v)) };
			state.effects?.setParams(fx);
			if (state.activePadIndex != null) state.padParams.setEffects(state.activePadIndex, fx);
		},
		format: (v) => String(Math.round(v))
	},
	{
		id: 'dtime', min: 0, max: 1.2, step: 0.01,
		get: () => (state.padParams.get(state.activePadIndex ?? 0).effects.delayTimeSec),
		set: (v) => {
			const fx: any = { delayTimeSec: Math.max(0, Math.min(1.2, v)) };
			state.effects?.setParams(fx);
			if (state.activePadIndex != null) state.padParams.setEffects(state.activePadIndex, fx);
			controls.setFxUI(fx);
		},
		format: (v) => (Math.round(v * 100) / 100).toFixed(2)
	},
	{
		id: 'dmix', min: 0, max: 1, step: 0.01,
		get: () => (state.padParams.get(state.activePadIndex ?? 0).effects.delayMix),
		set: (v) => {
			const fx: any = { delayMix: Math.max(0, Math.min(1, v)) };
			state.effects?.setParams(fx);
			if (state.activePadIndex != null) state.padParams.setEffects(state.activePadIndex, fx);
			controls.setFxUI(fx);
		},
		format: (v) => (Math.round(v * 100) / 100).toFixed(2)
	},
	{
		id: 'reverb', min: 0, max: 1, step: 0.01,
		get: () => (state.padParams.get(state.activePadIndex ?? 0).effects.reverbMix),
		set: (v) => {
			const fx: any = { reverbMix: Math.max(0, Math.min(1, v)) };
			state.effects?.setParams(fx);
			if (state.activePadIndex != null) state.padParams.setEffects(state.activePadIndex, fx);
			controls.setFxUI(fx);
		},
		format: (v) => (Math.round(v * 100) / 100).toFixed(2)
	},
	{
		id: 'gain', min: 0, max: 1.5, step: 0.01,
		get: () => (state.padParams.get(state.activePadIndex ?? 0).effects.masterGain),
		set: (v) => {
			const fx: any = { masterGain: Math.max(0, Math.min(1.5, v)) };
			state.effects?.setParams(fx);
			if (state.activePadIndex != null) state.padParams.setEffects(state.activePadIndex, fx);
			controls.setFxUI(fx);
		},
		format: (v) => (Math.round(v * 100) / 100).toFixed(2)
	}
];

function initParamTiles() {
	knobConfigs.forEach(cfg => {
		const knobEl = document.querySelector(`.knob[data-knob="${cfg.id}"]`) as HTMLElement | null;
		const valEl = document.querySelector(`.tile-value[data-val="${cfg.id}"]`) as HTMLElement | null;
		if (!knobEl || !valEl) return;
		// MIDI learn target binding
		(knobEl.closest('.param-tile') as HTMLElement).addEventListener('click', () => {
			if (state.midi.learnEnabled) {
				state.midi.pendingTarget = `knob:${cfg.id}`;
				highlightPending(state.midi.pendingTarget);
			}
		});
		let current = cfg.get();
		valEl.textContent = cfg.format(current);
		updateKnobAngle(knobEl, current, cfg);
		let dragging = false;
		let startY = 0;
		let startVal = current;
		const onDown = (ev: PointerEvent) => {
			dragging = true;
			// If MIDI learn is enabled, set this knob as target immediately
			if (state.midi.learnEnabled) {
				state.midi.pendingTarget = `knob:${cfg.id}`;
				highlightPending(state.midi.pendingTarget);
			}
			startY = ev.clientY;
			startVal = current;
			(knobEl as any).setPointerCapture?.(ev.pointerId);
		};
		const onMove = (ev: PointerEvent) => {
			if (!dragging) return;
			const dy = startY - ev.clientY; // upward increases value
			const range = cfg.max - cfg.min;
			const delta = (dy / 120) * range * 0.1; // sensitivity
			let next = startVal + delta;
			if (next < cfg.min) next = cfg.min;
			if (next > cfg.max) next = cfg.max;
			current = next;
			valEl.textContent = cfg.format(current);
			updateKnobAngle(knobEl, current, cfg);
			cfg.set(current);
		};
		const onUp = (ev: PointerEvent) => {
			dragging = false;
			(knobEl as any).releasePointerCapture?.(ev.pointerId);
		};
		knobEl.addEventListener('pointerdown', onDown);
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
	});
}

function updateKnobAngle(knobEl: HTMLElement, value: number, cfg: KnobConfig) {
	const norm = (value - cfg.min) / (cfg.max - cfg.min); // 0..1
	const angle = -135 + norm * 270; // sweep
	const dot = knobEl.querySelector('.knob-dot') as HTMLElement | null;
	if (dot) {
		const rect = knobEl.getBoundingClientRect();
		const radius = Math.max(0, Math.min(rect.width, rect.height) / 2 - 10); // 10px padding from edge
		dot.style.transform = `translate(-50%, -50%) rotate(${angle}deg) translateX(${radius}px)`;
	}
}

function refreshParamTilesFromState() {
	knobConfigs.forEach(cfg => {
		const knobEl = document.querySelector(`.knob[data-knob="${cfg.id}"]`) as HTMLElement | null;
		const valEl = document.querySelector(`.tile-value[data-val="${cfg.id}"]`) as HTMLElement | null;
		if (!knobEl || !valEl) return;
		const v = cfg.get();
		valEl.textContent = cfg.format(v);
		updateKnobAngle(knobEl, v, cfg);
	});
}

initParamTiles();
function snapshotBaseFromCurrentPad() {
	// snapshot current pad parameters as base
	if (state.activePadIndex == null) return;
	const pad = state.padParams.get(state.activePadIndex);
	xyBaseGranular = { ...pad.granular };
	xyBaseFx = { ...pad.effects };
	// snapshot current selection position (normalized)
	const sel = waveform.getSelection();
	if (sel && state.buffer) {
		const width = sel.end - sel.start;
		const movable = Math.max(0, state.buffer.duration - width);
		xyBaseSelectionPos = movable > 0 ? sel.start / movable : 0;
	} else {
		xyBaseSelectionPos = 0;
	}
}

// resnapshot base on pad change (handled in updatePadGrid pad selection)
// apply changes when moving
xy.onChange((pos) => {
	// Bilinear weights for 4 corners
	const wTL = (1 - pos.x) * (1 - pos.y);
	const wTR = pos.x * (1 - pos.y);
	const wBL = (1 - pos.x) * pos.y;
	const wBR = pos.x * pos.y;
	const mode = getXYMode();
	if (mode === 'pads') {
		// Set flag to prevent saving selection to pad during morphing
		isXYMorphing = true;
		// Mix between pads' stored parameters (always read from original pad values)
		const idxOf = (v: string) => Number(v.split(':')[1] ?? '0') || 0;
		const defs = [
			{ idx: idxOf(cornerTL.value), w: wTL },
			{ idx: idxOf(cornerTR.value), w: wTR },
			{ idx: idxOf(cornerBL.value), w: wBL },
			{ idx: idxOf(cornerBR.value), w: wBR }
		];
		// Sum weights for normalization (though weights sum to 1)
		const sumW = defs.reduce((s, d) => s + d.w, 0) || 1;
		const norm = defs.map(d => ({ ...d, w: d.w / sumW }));
		// Interpolate granular and fx from ORIGINAL pad values (never modify pads)
		const g: any = {};
		const f: any = {};
		// seed with zeros
		const samplePad = state.padParams.get(0);
		for (const k of Object.keys(samplePad.granular) as Array<keyof GranularParams>) g[k] = 0;
		for (const k of Object.keys(samplePad.effects) as Array<keyof EffectsParams>) f[k] = 0;
		for (const d of norm) {
			// Always read from original pad values, never from modified state
			const pad = state.padParams.get(d.idx);
			for (const k of Object.keys(pad.granular) as Array<keyof GranularParams>) {
				g[k] += (pad.granular[k] as number) * d.w;
			}
			for (const k of Object.keys(pad.effects) as Array<keyof EffectsParams>) {
				f[k] += (pad.effects[k] as number) * d.w;
			}
		}
		// Apply interpolated values to engine/effects/UI (but DO NOT save to pads)
		state.engine?.setParams(g);
		state.effects?.setParams(f);
		controls.setGranularUI(g);
		controls.setFxUI(f);
		// Interpolate selection (region) start/end if available
		if (state.buffer) {
			let haveAny = false;
			let start = 0;
			let end = 0;
			for (const d of norm) {
				const r = state.regions.get(d.idx);
				if (r) {
					start += r.start * d.w;
					end += r.end * d.w;
					haveAny = true;
				}
			}
			if (haveAny) {
				// clamp within buffer
				if (start < 0) start = 0;
				if (end > state.buffer.duration) end = state.buffer.duration;
				if (end < start) end = start;
				waveform.setSelection(start, end);
				updateSelPosUI();
			}
		}
		// Interpolate colors from pad colors
		const padColors = defs.map(d => PAD_COLORS[d.idx % PAD_COLORS.length]);
		const colorWeights = norm.map(d => d.w);
		const interpolatedColor = interpolateColors(padColors, colorWeights);
		waveform.setColor(interpolatedColor, hexToRgba(interpolatedColor, 0.18));
		// Reset flag after morphing
		isXYMorphing = false;
		// Update UI knobs to reflect interpolated values (not pad values)
		// Manually update knobs with interpolated values instead of reading from pads
		knobConfigs.forEach(cfg => {
			const knobEl = document.querySelector(`.knob[data-knob="${cfg.id}"]`) as HTMLElement | null;
			const valEl = document.querySelector(`.tile-value[data-val="${cfg.id}"]`) as HTMLElement | null;
			if (!knobEl || !valEl) return;
			let value = 0;
			// Map knob IDs to interpolated values
			if (cfg.id === 'pitch') value = g.pitchSemitones;
			else if (cfg.id === 'density') value = g.density;
			else if (cfg.id === 'grain') value = g.grainSizeMs;
			else if (cfg.id === 'rand') value = g.randomStartMs;
			else if (cfg.id === 'filter') value = f.filterCutoffHz;
			else if (cfg.id === 'res') value = f.filterQ ?? 0;
			else if (cfg.id === 'dtime') value = f.delayTimeSec;
			else if (cfg.id === 'dmix') value = f.delayMix;
			else if (cfg.id === 'reverb') value = f.reverbMix;
			else if (cfg.id === 'gain') value = f.masterGain;
			else if (cfg.id === 'selpos') {
				// Calculate selection position from interpolated selection
				const sel = waveform.getSelection();
				if (sel && state.buffer) {
					const width = sel.end - sel.start;
					const movable = Math.max(0, state.buffer.duration - width);
					value = movable > 0 ? (sel.start / movable) : 0;
				} else {
					value = 0;
				}
			}
			valEl.textContent = cfg.format(value);
			updateKnobAngle(knobEl, value, cfg);
		});
		return;
	}
	// Default: parameters mode - influence toward PARAMS maxima from base snapshot
	if (xyBaseGranular == null || xyBaseFx == null) snapshotBaseFromCurrentPad();
	if (!xyBaseGranular || !xyBaseFx) return;
	const cornerDefs = [
		{ id: cornerTL.value as ParamId, weight: wTL },
		{ id: cornerTR.value as ParamId, weight: wTR },
		{ id: cornerBL.value as ParamId, weight: wBL },
		{ id: cornerBR.value as ParamId, weight: wBR }
	];
	const influenceMap = new Map<ParamId, number>();
	for (const c of cornerDefs) {
		influenceMap.set(c.id, (influenceMap.get(c.id) ?? 0) + c.weight);
	}
	const granularUpdate: any = {};
	const fxUpdate: any = {};
	let selectionUpdateApplied = false;
	for (const [paramId, infl] of influenceMap.entries()) {
		const meta = PARAMS.find(p => p.id === paramId)!;
		const baseVal =
			meta.kind === 'granular' ? (xyBaseGranular as any)[meta.id] as number :
			meta.kind === 'fx' ? (xyBaseFx as any)[meta.id] as number :
			(xyBaseSelectionPos ?? 0);
		const targetVal = meta.max;
		const newVal = baseVal + (targetVal - baseVal) * Math.max(0, Math.min(1, infl));
		if (meta.kind === 'granular') {
			granularUpdate[meta.id] = newVal;
		} else if (meta.kind === 'fx') {
			fxUpdate[meta.id] = newVal;
		} else if (meta.kind === 'selection' && !selectionUpdateApplied) {
			const sel = waveform.getSelection();
			if (sel && state.buffer) {
				const width = sel.end - sel.start;
				const movable = Math.max(0, state.buffer.duration - width);
				let newStart = movable * Math.max(0, Math.min(1, newVal));
				let newEnd = newStart + width;
				if (newEnd > state.buffer.duration) { newEnd = state.buffer.duration; newStart = Math.max(0, newEnd - width); }
				waveform.setSelection(newStart, newEnd);
				updateSelPosUI();
				selectionUpdateApplied = true;
			}
		}
	}
	if (Object.keys(granularUpdate).length) {
		state.engine?.setParams(granularUpdate);
		controls.setGranularUI(granularUpdate);
		if (state.activePadIndex != null) state.padParams.setGranular(state.activePadIndex, granularUpdate);
	}
	if (Object.keys(fxUpdate).length) {
		state.effects?.setParams(fxUpdate);
		controls.setFxUI(fxUpdate);
		if (state.activePadIndex != null) state.padParams.setEffects(state.activePadIndex, fxUpdate);
	}
	refreshParamTilesFromState();
});



