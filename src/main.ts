import { createAudioContextManager } from './modules/audio/AudioContextManager';
import { createAudioRecorder } from './modules/audio/AudioRecorder';
import { loadAudioFile } from './modules/audio/AudioFileLoader';
import { createRegionStore, type Region } from './modules/editor/RegionStore';
import { createEffectsChain, type EffectsChain } from './modules/effects/EffectsChain';
import { createGranularWorkletEngine, type GranularWorkletEngine } from './modules/granular/GranularWorkletEngine';
import { createPadGrid } from './modules/ui/PadGrid';
import { setupControls } from './modules/ui/Controls';
import { createWaveformView } from './modules/ui/WaveformView';
import { createXYPadThree } from './modules/ui/XYPadThree';
import { createMotionPanel } from './modules/ui/MotionPanel';
import { PARAMS, type ParamId } from './modules/ui/ParamRegistry';
import { MidiManager, type MidiMapping, loadMappings, saveMappings } from './modules/midi/MidiManager';
import { createPadParamStore, defaultEffects } from './modules/editor/PadParamStore';
import type { GranularParams } from './modules/granular/GranularWorkletEngine';
import type { EffectsParams } from './modules/effects/EffectsChain';
import { createFloatingPanelManager } from './modules/ui/FloatingPanelManager';
import { createCustomSelect, type SelectOption } from './modules/ui/CustomSelect';
import { createThemeManager } from './modules/ui/ThemeManager';
import { createUpdateManager } from './modules/utils/updateManager';

type AppState = {
	contextMgr: ReturnType<typeof createAudioContextManager>;
	buffer: AudioBuffer | null;
	effects: EffectsChain | null;
	engine: GranularWorkletEngine | null;
	regions: ReturnType<typeof createRegionStore>;
	activePadIndex: number | null;
	padParams: ReturnType<typeof createPadParamStore>;
	recallPerPad: boolean;
	recorder: ReturnType<typeof createAudioRecorder> | null;
	recordingTimer: number | null;
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
	regions: createRegionStore(1),
	activePadIndex: null,
	padParams: createPadParamStore(1),
	recallPerPad: true,
	recorder: null,
	recordingTimer: null,
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
const waveZoomInput = document.getElementById('waveZoom') as HTMLInputElement;
const waveform = createWaveformView(waveformCanvas);
const recallPerPadEl = document.getElementById('recallPerPad') as HTMLInputElement;
const midiLearnEl = document.getElementById('midiLearn') as HTMLInputElement | null;
const midiClearBtn = document.getElementById('midiClear') as HTMLButtonElement | null;
const xyCanvas = document.getElementById('xyPad') as HTMLCanvasElement;
const xy = createXYPadThree(xyCanvas);
const xyModeParamsBtn = document.getElementById('xyModeParams') as HTMLButtonElement | null;
const xyModePadsBtn = document.getElementById('xyModePads') as HTMLButtonElement | null;
const cornerTL = document.getElementById('xyCornerTL') as HTMLElement;
const cornerTR = document.getElementById('xyCornerTR') as HTMLElement;
const cornerBL = document.getElementById('xyCornerBL') as HTMLElement;
const cornerBR = document.getElementById('xyCornerBR') as HTMLElement;
const recordBtn = document.getElementById('recordBtn') as HTMLButtonElement;
const recordVideoBtn = document.getElementById('recordVideoBtn') as HTMLButtonElement;
const stopRecordBtn = document.getElementById('stopRecordBtn') as HTMLButtonElement;
const recordStatusEl = document.getElementById('recordStatus') as HTMLElement;
const themeToggleBtn = document.getElementById('themeToggle') as HTMLButtonElement;
const themeIcon = document.getElementById('themeIcon') as HTMLElement;
const appLogo = document.getElementById('appLogo') as HTMLImageElement;

// Helper to get correct asset path for Electron and browser
function getAssetPath(path: string): string {
	// Normalize path (remove leading slash if present, then add ./)
	const normalizedPath = path.startsWith('/') ? path.substring(1) : path;
	// In Vite with base: './', relative paths work in both dev and production
	// Use relative paths for better Electron compatibility
	return './' + normalizedPath;
}

// Function to update logo based on theme
function updateLogo(theme: 'dark' | 'light') {
	if (appLogo) {
		appLogo.src = theme === 'dark' 
			? getAssetPath('/images/logo.png') 
			: getAssetPath('/images/logo_dark.png');
	}
}

// Initialize Theme Manager
const themeManager = createThemeManager();
themeManager.init();
const initialTheme = themeManager.getTheme();
// Update icon and logo based on initial theme
themeIcon.textContent = initialTheme === 'dark' ? '☀' : '🌙';
updateLogo(initialTheme);

// Theme toggle handler
if (themeToggleBtn && themeIcon) {
	themeToggleBtn.addEventListener('click', () => {
		const newTheme = themeManager.toggle();
		themeIcon.textContent = newTheme === 'dark' ? '☀' : '🌙';
		updateLogo(newTheme);
	});
}

// Watch for theme changes and update UI components
const themeObserver = new MutationObserver(() => {
	const currentTheme = document.documentElement.getAttribute('data-theme') as 'dark' | 'light' | null;
	if (currentTheme) {
		updateLogo(currentTheme);
	}
	// Redraw waveform when theme changes
	if (waveform) {
		waveform.forceRedraw();
	}
	// Update XY pad theme colors
	if (xy?.updateTheme) {
		xy.updateTheme();
	}
});
themeObserver.observe(document.documentElement, {
	attributes: true,
	attributeFilter: ['data-theme']
});

// Initialize Floating Panel Manager
const panelManager = createFloatingPanelManager();

// Register floating panels with default positions
const waveformPanel = document.getElementById('panel-waveform') as HTMLElement;
const parametersPanel = document.getElementById('panel-parameters') as HTMLElement;
const effectsPanel = document.getElementById('panel-effects') as HTMLElement;

if (waveformPanel) {
	panelManager.registerPanel({
		id: 'waveform',
		element: waveformPanel,
		defaultPosition: { x: 20, y: 20 },
		defaultSize: { width: 500, height: 400 },
		minSize: { width: 350, height: 250 },
		resizable: true
	});
}

if (parametersPanel) {
	panelManager.registerPanel({
		id: 'parameters',
		element: parametersPanel,
		defaultPosition: { x: window.innerWidth - 300, y: 420 },
		defaultSize: { width: 260, height: 280 },
		minSize: { width: 240, height: 260 },
		resizable: true
	});
}

if (effectsPanel) {
	panelManager.registerPanel({
		id: 'effects',
		element: effectsPanel,
		defaultPosition: { x: window.innerWidth - 300, y: 20 },
		defaultSize: { width: 260, height: 400 },
		minSize: { width: 240, height: 380 },
		resizable: true
	});
}

const motionPanel = document.getElementById('panel-motion') as HTMLElement;
let motionCtrl: ReturnType<typeof createMotionPanel> | null = null;
if (motionPanel) {
	panelManager.registerPanel({
		id: 'motion',
		element: motionPanel,
		defaultPosition: { x: 20, y: 440 },
		defaultSize: { width: 250, height: 350 },
		minSize: { width: 200, height: 300 },
		resizable: true
	});

	motionCtrl = createMotionPanel({
		canvas: document.getElementById('motionCanvas') as HTMLCanvasElement,
		cursor: document.getElementById('motionCursor') as HTMLElement,
		recordBtn: document.getElementById('motionRecordBtn') as HTMLButtonElement,
		playBtn: document.getElementById('motionPlayBtn') as HTMLButtonElement,
		clearBtn: document.getElementById('motionClearBtn') as HTMLButtonElement,
		loopModeSelect: document.getElementById('motionLoopMode') as HTMLSelectElement,
		speedInput: document.getElementById('motionSpeed') as HTMLInputElement,
		onPosition: (x, y) => {
			if (xy && xy.setPosition) {
				xy.setPosition(x, y);
			}
		}
	});

	// Stop motion playback if user interacts with main XY pad
	xyCanvas.addEventListener('pointerdown', () => {
		if (motionCtrl && motionCtrl.isPlaying()) {
			motionCtrl.stop();
		}
	});
}

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
	unlockBtn.textContent = 'Audio Unlocked';
});

// ---------- Audio/Video Recording ----------
let isVideoRecording = false;

function updateRecordingUI() {
	if (!state.recorder) return;
	const isRecording = state.recorder.isRecording();
	recordBtn.disabled = isRecording;
	recordVideoBtn.disabled = isRecording;
	stopRecordBtn.disabled = !isRecording;
	if (isRecording) {
		const duration = state.recorder.getDuration();
		const mins = Math.floor(duration / 60);
		const secs = Math.floor(duration % 60);
		const mode = isVideoRecording ? 'Video' : 'Audio';
		recordStatusEl.textContent = `● Recording ${mode}: ${mins}:${secs.toString().padStart(2, '0')}`;
	} else {
		recordStatusEl.textContent = '';
		isVideoRecording = false;
	}
}

function showPermissionHelp() {
	const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
	let msg = 'Permission to record screen was denied.\n\nPlease enable Screen Recording permission for this app in your system settings.';
	if (isMac) {
		msg = 'Screen Recording permission denied.\n\n1. Open System Settings > Privacy & Security > Screen Recording\n2. Enable toggle for "Undergrain" (or your terminal/Electron)\n3. Restart the app';
	}
	alert(msg);
}

recordBtn.addEventListener('click', async () => {
	ensureEffects();
	if (!state.recorder) return;
	try {
		await state.recorder.start(false); // Audio only
		isVideoRecording = false;
		updateRecordingUI();
		// Update UI every second
		state.recordingTimer = setInterval(() => {
			updateRecordingUI();
		}, 1000) as any as number;
	} catch (error) {
		console.error('Error starting recording:', error);
		recordStatusEl.textContent = 'Error starting recording';
	}
});

recordVideoBtn.addEventListener('click', async () => {
	ensureEffects();
	if (!state.recorder) return;
	try {
		await state.recorder.start(true); // Video + Audio
		isVideoRecording = true;
		updateRecordingUI();
		// Update UI every second
		state.recordingTimer = setInterval(() => {
			updateRecordingUI();
		}, 1000) as any as number;
	} catch (error) {
		console.error('Error starting video recording:', error);
		if ((error as Error).message === 'PermissionDenied' || (error as any).name === 'NotAllowedError' || (error as any).name === 'AbortError') {
			showPermissionHelp();
			recordStatusEl.textContent = 'Permission denied';
		} else {
			recordStatusEl.textContent = 'Error starting video recording';
		}
		setTimeout(() => {
			recordStatusEl.textContent = '';
		}, 3000);
	}
});

stopRecordBtn.addEventListener('click', async () => {
	if (!state.recorder) return;
	const blob = await state.recorder.stop();
	if (state.recordingTimer) {
		clearInterval(state.recordingTimer);
		state.recordingTimer = null;
	}
	updateRecordingUI();
	if (blob) {
		// Create download link
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
		
		// Determine extension and type from blob MIME type
		let extension = 'wav';
		let type = 'audio';
		
		if (blob.type.startsWith('video/')) {
			type = 'video';
			if (blob.type.includes('mp4')) {
				extension = 'mp4';
			} else if (blob.type.includes('webm')) {
				extension = 'webm';
			} else {
				extension = 'webm'; // fallback
			}
		} else if (blob.type.startsWith('audio/')) {
			type = 'audio';
			if (blob.type.includes('wav')) {
				extension = 'wav';
			} else {
				extension = 'wav'; // fallback
			}
		}
		
		a.href = url;
		a.download = `undergrain-${type}-${timestamp}.${extension}`;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
		recordStatusEl.textContent = `✓ ${type} recording saved`;
		setTimeout(() => {
			recordStatusEl.textContent = '';
		}, 3000);
	}
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
				populateParamSelect(customSelectTL);
				populateParamSelect(customSelectTR);
				populateParamSelect(customSelectBL);
				populateParamSelect(customSelectBR);
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
				console.warn('Web MIDI not available or permission not granted.');
				alert('Unable to enable MIDI. Check browser permission and try again (Chrome/Edge).');
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

if (waveZoomInput) {
	waveZoomInput.addEventListener('input', () => {
		const val = parseFloat(waveZoomInput.value);
		if (waveform.setScale) {
			waveform.setScale(val);
		}
	});
}

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

	const fileNameEl = document.getElementById('fileName');
	const resetStatus = (msg?: string) => {
		if (fileNameEl) fileNameEl.textContent = msg ?? '';
	};

	try {
		console.log('File selected:', file.name, file.type, `${(file.size / (1024 * 1024)).toFixed(1)} MB`);
		resetStatus('Loading...');
		await ensureAudioReady();
		console.log('Audio context unlocked');

		const loaded = await loadAudioFile(state.contextMgr.audioContext, file);
		console.log('Audio decoded:', loaded.audioBuffer.duration, 'seconds');
		resetStatus(loaded.name);
		
		state.buffer = loaded.audioBuffer;
		
		console.log('Ensuring engine...');
		await ensureEngine(); // Now await this!
		console.log('Engine ensured');

		ensureEffects();
		// If no active pad, select the first one by default
		if (state.activePadIndex === null && state.regions.getAll().length > 0) {
			state.activePadIndex = 0;
			// Also ensure we are synced with this pad's parameters
			recallPadParams(0, 0); 
		}
		updatePadGrid();
		waveform.setBuffer(loaded.audioBuffer);
		bufferDurEl.textContent = `Duration: ${loaded.audioBuffer.duration.toFixed(2)}s`;
		updateSelPosUI();
		
		if (state.engine) {
			console.log('Setting buffer to engine...');
			try {
				await state.engine.setBuffer(loaded.audioBuffer);
				state.engine.setRegion(0, loaded.audioBuffer.duration);
				console.log('Buffer set to engine');
			} catch (err) {
				console.error('Error setting buffer to engine:', err);
				throw err;
			}
		}
	} catch (error) {
		console.error('Error loading audio file:', error);
		resetStatus('Error loading file');
		alert(error instanceof Error ? error.message : 'Error loading audio file. See console for details.');
	} finally {
		// keep the input reset so re-selecting the same file works
		(e.target as HTMLInputElement).value = '';
	}
});

function ensureAudioReady() {
	return state.contextMgr.unlock();
}

async function ensureEngine() { // Changed to async
	if (!state.engine) {
		// init worklet engine asynchronously
		try {
			const eng = await createGranularWorkletEngine(state.contextMgr.audioContext);
			state.engine = eng;
			ensureEffects();
			// Push current FX params into the Rust engine
			applyFxToEngine({});
			state.engine?.connect(state.effects!.input);
			if (state.buffer) {
				state.engine.setBuffer(state.buffer);
				state.engine.setRegion(0, state.buffer.duration);
			}
		} catch (err) {
			console.error('Worklet error:', err);
			throw err; // Re-throw to handle in caller
		}
	}
}

function ensureEffects() {
	if (!state.effects) {
		state.effects = createEffectsChain(state.contextMgr.audioContext);
		state.engine?.connect(state.effects.input);
		state.effects.output.connect(state.contextMgr.audioContext.destination);
	}
	// Initialize or update recorder when effects are ready
	if (state.effects && !state.recorder) {
		state.recorder = createAudioRecorder(state.contextMgr.audioContext, state.effects.output);
	}
}

function getActiveFxParams(): EffectsParams {
	if (state.activePadIndex != null) {
		return state.padParams.get(state.activePadIndex).effects;
	}
	return defaultEffects();
}

function applyFxToEngine(patch: Partial<EffectsParams>) {
	const base = getActiveFxParams();
	const merged = { ...base, ...patch };
	if (state.activePadIndex != null) {
		state.padParams.setEffects(state.activePadIndex, merged);
	}
	state.engine?.setEffectParams(merged);
	return merged;
}

const PAD_COLORS = ['#A1E34B', '#66D9EF', '#FDBC40', '#FF7AA2', '#7C4DFF', '#00E5A8', '#F06292', '#FFD54F'];

function updatePadGrid() {
	padGridEl.innerHTML = '';
	const padGrid = createPadGrid(padGridEl, state.regions.getAll(), { colors: PAD_COLORS, activeIndex: state.activePadIndex });
	padGrid.onAdd = () => {
		state.regions.add();
		state.padParams.add();
		updatePadGrid();
		// Update XY pad dropdowns if in pad mode
		if (getXYMode() === 'pads') {
			populateParamSelect(customSelectTL);
			populateParamSelect(customSelectTR);
			populateParamSelect(customSelectBL);
			populateParamSelect(customSelectBR);
			refreshXYCornerLabels();
		}
	};
	padGrid.onPadPress = (index) => {
		if (state.midi?.learnEnabled) {
			state.midi.pendingTarget = `pad:${index}`;
			highlightPending(state.midi.pendingTarget);
			return;
		}
		const prevIndex = state.activePadIndex;
		state.activePadIndex = index;
		snapshotBaseFromCurrentPad();
		
		// If smooth recall is enabled, handle everything in recallPadParams
		if (state.recallPerPad) {
			recallPadParams(index, 300, prevIndex);
			// Colorize waveform selection based on pad (visual only, selection moves in recallPadParams)
			const c = PAD_COLORS[index % PAD_COLORS.length];
			waveform.setColor(c, hexToRgba(c, 0.18));
			
			// Ensure engine is running
			if (state.engine && state.buffer) {
				state.engine.trigger();
			}
		} else {
			// Instant recall behavior
			const c = PAD_COLORS[index % PAD_COLORS.length];
			waveform.setColor(c, hexToRgba(c, 0.18));
			recallWaveformSelection(index);
			updateSelPosUI();
			
			const region = state.regions.get(index);
			if (region && state.buffer) triggerRegion(region);
		}
	};
	padGrid.onPadLongPress = (index) => {
		if (state.midi?.learnEnabled) {
			state.midi.pendingTarget = `pad:${index}`;
			highlightPending(state.midi.pendingTarget);
			return;
		}
		const prevIndex = state.activePadIndex;
		state.activePadIndex = index;
		snapshotBaseFromCurrentPad();
		
		// colorize waveform for this pad
		const c = PAD_COLORS[index % PAD_COLORS.length];
		waveform.setColor(c, hexToRgba(c, 0.18));
		
		if (state.recallPerPad) {
			recallPadParams(index, 300, prevIndex);
		} else {
			// Instant recall
			const existingRegion = state.regions.get(index);
			if (existingRegion) {
				recallWaveformSelection(index);
			}
		}
		
		updateSelPosUI();
		// ... existing long press logic for assigning selection ...
		if (!state.buffer) return;
		const sel = waveform.getSelection();
		if (sel) {
			// Only show prompt if we're not just switching/recalling
			// Actually long press is usually for assigning.
			// If we just interpolated to it, we might be at the target region already or moving there.
			// But assignment takes CURRENT selection.
			// If we are moving, taking current selection is weird.
			// Standard behavior: long press assigns CURRENT selection to pad.
			const name = prompt('Name (optional):', state.regions.get(index)?.name ?? '') ?? '';
			const region = { start: sel.start, end: sel.end, name: name || undefined };
			state.regions.set(index, region);
			// ensure waveform reflects what we just assigned (stops interpolation if any?)
			// If we just assigned it, we want it to stay there.
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
		ensureEngine();
		applyFxToEngine(fx as EffectsParams);
	}
});

// Initial render
updatePadGrid();

// Helper to calculate parameter weight based on XY position and corner mappings
	function calculateParamWeight(paramId: string, pos: { x: number; y: number }): number {
		if (getXYMode() === 'pads') return 0; // In pads mode, parameter visualization is driven by pad values directly (or disabled)
		
		const wTL = (1 - pos.x) * (1 - pos.y);
		const wTR = pos.x * (1 - pos.y);
		const wBL = (1 - pos.x) * pos.y;
		const wBR = pos.x * pos.y;
		
		let weight = 0;
		if (customSelectTL?.getValue() === paramId) weight += wTL;
		if (customSelectTR?.getValue() === paramId) weight += wTR;
		if (customSelectBL?.getValue() === paramId) weight += wBL;
		if (customSelectBR?.getValue() === paramId) weight += wBR;
		
		return weight;
	}

	// Smoothly recall parameters for a pad and move UI controls
	let recallTimer: number | null = null;
	function recallPadParams(index: number, durationMs = 300, fromIndex: number | null = null) {
		const target = state.padParams.get(index);
		if (!target) return;
		// cancel any ongoing transition
		if (recallTimer != null) { clearInterval(recallTimer); recallTimer = null; }
		
		const targetXY = target.xy || { x: 0.5, y: 0.5 };

		// If duration is 0 or very short, skip interpolation and set immediately (optimizes manual pad switch)
		if (durationMs < 16) {
			const region = state.regions.get(index);
			const safeRegion = region ? { start: region.start, end: region.end } : { start: 0, end: state.buffer?.duration || 0 };
			state.engine?.setAllParams(target.granular, target.effects, safeRegion);
			
			// Visual updates for instant recall
			if (safeRegion.end > 0) waveform.setSelection(safeRegion.start, safeRegion.end);
			updateSelPosUI();
			
			controls.setGranularUI(target.granular);
			controls.setFxUI(target.effects);
			refreshParamTilesFromState();
			
			// Restore XY position for this pad
			if (target.xy && xy.setPositionSilent) {
				xy.setPositionSilent(target.xy.x, target.xy.y);
			}
			
			// Update visual cues immediately
			xy.setReverbMix?.(target.effects.reverbMix);
			
			const cutoffWeight = calculateParamWeight('filterCutoffHz', targetXY);
			xy.setFilterCutoff?.(target.effects.filterCutoffHz, cutoffWeight);
			
			const densityWeight = calculateParamWeight('density', targetXY);
			xy.setDensity?.(target.granular.density, densityWeight);
			return;
		}

		const steps = Math.max(1, Math.floor(durationMs / 16));
		let step = 0;
		// Read current from active pad state (robust even if sliders are not present)
		// Use fromIndex if provided, otherwise fallback to index (instant jump if no previous pad)
		const effectiveFromIndex = fromIndex ?? index;
		const currentPad = state.padParams.get(effectiveFromIndex);
		const fromG = currentPad.granular;
		const fromFx = currentPad.effects;
		const fromXY = currentPad.xy || { x: 0.5, y: 0.5 };
		
		// Interpolate regions: Start from current waveform selection
		const currentSel = waveform.getSelection();
		const fromRegion = currentSel ? { start: currentSel.start, end: currentSel.end } : { start: 0, end: 0 };
		const targetRegionData = state.regions.get(index);
		const toRegion = targetRegionData ? { start: targetRegionData.start, end: targetRegionData.end } : { start: 0, end: state.buffer?.duration || 0 };

		const toG = target.granular;
		const toFx = target.effects;
		const toXY = targetXY;
		
		// ensure UI reflects start
		controls.setGranularUI(fromG);
		controls.setFxUI(fromFx);
		if (xy.setPositionSilent) xy.setPositionSilent(fromXY.x, fromXY.y);
		
		// Initialize visual state to "from" values immediately to prevent flash of target state
		xy.setReverbMix?.(fromFx.reverbMix);
		const startCutoffWeight = calculateParamWeight('filterCutoffHz', fromXY);
		xy.setFilterCutoff?.(fromFx.filterCutoffHz, startCutoffWeight);
		const startDensityWeight = calculateParamWeight('density', fromXY);
		xy.setDensity?.(fromG.density, startDensityWeight);
		
		refreshParamTilesFromState();
		recallTimer = setInterval(() => {
			step++;
			const t = step / steps;
			// Smoothstep easing (t*t*(3-2*t)) for smoother motion
			const ease = t * t * (3 - 2 * t);
			
			// Smooth interpolation for XY position
			const interpXY = {
				x: fromXY.x + (toXY.x - fromXY.x) * ease,
				y: fromXY.y + (toXY.y - fromXY.y) * ease
			};
			if (xy.setPositionSilent) xy.setPositionSilent(interpXY.x, interpXY.y);
			
			// Smooth interpolation for Region
			const interpRegion = {
				start: fromRegion.start + (toRegion.start - fromRegion.start) * ease,
				end: fromRegion.end + (toRegion.end - fromRegion.end) * ease
			};
			waveform.setSelection(interpRegion.start, interpRegion.end);
			updateSelPosUI();

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
				delayFeedback: fromFx.delayFeedback! + ((toFx.delayFeedback ?? 0.3) - fromFx.delayFeedback!) * t,
				reverbMix: fromFx.reverbMix + (toFx.reverbMix - fromFx.reverbMix) * t,
				masterGain: fromFx.masterGain + (toFx.masterGain - fromFx.masterGain) * t
			};
			
			// Update Engine with all interpolated params including Region
			// This effectively scrubs audio across the file during transition!
			state.engine?.setAllParams(interpG, interpFx, interpRegion);
			
			// Sincronizza il riverbero con l'XYPad durante l'interpolazione
			xy.setReverbMix?.(interpFx.reverbMix);
			
			// Sincronizza il filtro cutoff con l'XYPad durante l'interpolazione
			const cutoffWeight = calculateParamWeight('filterCutoffHz', interpXY);
			xy.setFilterCutoff?.(interpFx.filterCutoffHz, cutoffWeight);
			
			// Sincronizza la densità con l'XYPad durante l'interpolazione
			const densityWeight = calculateParamWeight('density', interpXY);
			xy.setDensity?.(interpG.density, densityWeight);
			
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
let customSelectTL: ReturnType<typeof createCustomSelect> | null = null;
let customSelectTR: ReturnType<typeof createCustomSelect> | null = null;
let customSelectBL: ReturnType<typeof createCustomSelect> | null = null;
let customSelectBR: ReturnType<typeof createCustomSelect> | null = null;

function getParamOptions(): SelectOption[] {
	const mode = getXYMode();
	if (mode === 'pads') {
		const padCount = state.regions.getAll().length;
		const options: SelectOption[] = [];
		for (let i = 0; i < padCount; i++) {
			const r = state.regions.get(i);
			if (r) {
				const name = r.name ? ` – ${r.name}` : '';
				options.push({
					value: `pad:${i}`,
					label: `Pad ${i + 1}${name}`
				});
			}
		}
		return options;
	} else {
		return PARAMS.map(p => ({
			value: p.id,
			label: p.label
		}));
	}
}

function populateParamSelect(select: ReturnType<typeof createCustomSelect> | null) {
	if (!select) return;
	const currentValue = select.getValue();
	const options = getParamOptions();
	select.setOptions(options);
	
	// Restore previous value if it exists, otherwise use first option
	if (currentValue && options.some(opt => opt.value === currentValue)) {
		select.setValue(currentValue);
	} else if (options.length > 0) {
		select.setValue(options[0].value);
	}
}

// Initialize custom selects
customSelectTL = createCustomSelect({
	element: cornerTL,
	options: getParamOptions(),
	value: 'filterCutoffHz',
	onChange: (value) => {
		refreshXYCornerLabels();
	}
});

customSelectTR = createCustomSelect({
	element: cornerTR,
	options: getParamOptions(),
	value: 'density',
	onChange: (value) => {
		refreshXYCornerLabels();
	}
});

customSelectBL = createCustomSelect({
	element: cornerBL,
	options: getParamOptions(),
	value: 'reverbMix',
	onChange: (value) => {
		refreshXYCornerLabels();
	}
});

customSelectBR = createCustomSelect({
	element: cornerBR,
	options: getParamOptions(),
	value: 'pitchSemitones',
	onChange: (value) => {
		refreshXYCornerLabels();
	}
});

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
			tl: label(customSelectTL?.getValue() || ''),
			tr: label(customSelectTR?.getValue() || ''),
			bl: label(customSelectBL?.getValue() || ''),
			br: label(customSelectBR?.getValue() || '')
		});
		// In modalità pads, resetta tutti gli effetti visivi
		xy.setReverbMix?.(0);
		xy.setFilterCutoff?.(4000, 0);
		xy.setDensity?.(15, 0);
	} else {
		const label = (id: string) => PARAMS.find(p => p.id === (id as ParamId))?.label ?? '';
		xy.setCornerLabels({
			tl: label(customSelectTL?.getValue() || ''),
			tr: label(customSelectTR?.getValue() || ''),
			bl: label(customSelectBL?.getValue() || ''),
			br: label(customSelectBR?.getValue() || '')
		});
		// Verifica quali parametri sono attualmente associati ai vertici
		const currentParams = new Set<ParamId>();
		const tl = customSelectTL?.getValue() as ParamId;
		const tr = customSelectTR?.getValue() as ParamId;
		const bl = customSelectBL?.getValue() as ParamId;
		const br = customSelectBR?.getValue() as ParamId;
		if (tl) currentParams.add(tl);
		if (tr) currentParams.add(tr);
		if (bl) currentParams.add(bl);
		if (br) currentParams.add(br);
		
		// Resetta gli effetti per i parametri che non sono più associati
		if (!currentParams.has('reverbMix')) {
			xy.setReverbMix?.(0);
		}
		if (!currentParams.has('filterCutoffHz')) {
			xy.setFilterCutoff?.(4000, 0);
		}
		if (!currentParams.has('density')) {
			xy.setDensity?.(15, 0);
		}
	}
}
refreshXYCornerLabels();
// react to mode changes
function handleXYModeChange(mode: 'params' | 'pads') {
	setXYMode(mode);
	populateParamSelect(customSelectTL);
	populateParamSelect(customSelectTR);
	populateParamSelect(customSelectBL);
	populateParamSelect(customSelectBR);
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
		customSelectTL?.setValue(`pad:${defaults[0]}`);
		customSelectTR?.setValue(`pad:${defaults[1]}`);
		customSelectBL?.setValue(`pad:${defaults[2]}`);
		customSelectBR?.setValue(`pad:${defaults[3]}`);
	} else {
		customSelectTL?.setValue('filterCutoffHz');
		customSelectTR?.setValue('density');
		customSelectBL?.setValue('reverbMix');
		customSelectBR?.setValue('pitchSemitones');
	}
	refreshXYCornerLabels();
}
xyModeParamsBtn?.addEventListener('click', () => handleXYModeChange('params'));
xyModePadsBtn?.addEventListener('click', () => handleXYModeChange('pads'));
// Initialize default mode (params)
setXYMode('params');

// ---------- Param tiles (knobs) ----------
type KnobConfig = {
	id: 'pitch' | 'density' | 'grain' | 'rand' | 'selpos' | 'filter' | 'res' | 'dtime' | 'dmix' | 'reverb' | 'gain' | 'xyspeed' | 'xyshift';
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
			// Aggiorna l'animazione della griglia quando cambia la densità (peso 0 perché non viene da XYPad)
			xy.setDensity?.(p.density, 0);
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
			applyFxToEngine(fx);
			if (state.activePadIndex != null) state.padParams.setEffects(state.activePadIndex, fx);
			controls.setFxUI(fx);
			// Aggiorna il colore ciano quando cambia il filtro cutoff (peso 0 perché non viene da XYPad)
			xy.setFilterCutoff?.(fx.filterCutoffHz, 0);
		},
		format: (v) => String(Math.round(v))
	},
	{
		id: 'res', min: 0, max: 20, step: 0.1,
		get: () => (state.padParams.get(state.activePadIndex ?? 0).effects.filterQ ?? 0),
		set: (v) => {
			const fx: any = { filterQ: Math.max(0, Math.min(20, v)) };
			applyFxToEngine(fx);
			if (state.activePadIndex != null) state.padParams.setEffects(state.activePadIndex, fx);
		},
		format: (v) => String(Math.round(v))
	},
	{
		id: 'dtime', min: 0, max: 1.2, step: 0.01,
		get: () => (state.padParams.get(state.activePadIndex ?? 0).effects.delayTimeSec),
		set: (v) => {
			const fx: any = { delayTimeSec: Math.max(0, Math.min(1.2, v)) };
			applyFxToEngine(fx);
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
			applyFxToEngine(fx);
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
			applyFxToEngine(fx);
			if (state.activePadIndex != null) state.padParams.setEffects(state.activePadIndex, fx);
			controls.setFxUI(fx);
			// Aggiorna il numero di simboli nell'XYPad in base al riverbero
			xy.setReverbMix?.(v);
		},
		format: (v) => (Math.round(v * 100) / 100).toFixed(2)
	},
	{
		id: 'gain', min: 0, max: 1.5, step: 0.01,
		get: () => (state.padParams.get(state.activePadIndex ?? 0).effects.masterGain),
		set: (v) => {
			const fx: any = { masterGain: Math.max(0, Math.min(1.5, v)) };
			applyFxToEngine(fx);
			if (state.activePadIndex != null) state.padParams.setEffects(state.activePadIndex, fx);
			controls.setFxUI(fx);
		},
		format: (v) => (Math.round(v * 100) / 100).toFixed(2)
	},
	{
		id: 'xyspeed', min: 0.01, max: 2.0, step: 0.01,
		get: () => 0.15, // Default value, will be updated by knob
		set: (v) => {
			const normal = Math.max(0.01, Math.min(2.0, v));
			const shift = knobConfigs.find(k => k.id === 'xyshift')?.get() ?? 0.05;
			xy.setSpeed?.(normal, shift);
		},
		format: (v) => (Math.round(v * 100) / 100).toFixed(2)
	},
	{
		id: 'xyshift', min: 0.01, max: 1.0, step: 0.01,
		get: () => 0.05, // Default value, will be updated by knob
		set: (v) => {
			const shift = Math.max(0.01, Math.min(1.0, v));
			const normal = knobConfigs.find(k => k.id === 'xyspeed')?.get() ?? 0.15;
			xy.setSpeed?.(normal, shift);
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
// Initialize XY Pad speeds
xy.setSpeed?.(0.15, 0.05);
// Sincronizza il valore iniziale del riverbero, filtro cutoff e densità
if (state.activePadIndex != null) {
	const pad = state.padParams.get(state.activePadIndex);
	xy.setReverbMix?.(pad.effects.reverbMix);
	xy.setFilterCutoff?.(pad.effects.filterCutoffHz, 0);
	xy.setDensity?.(pad.granular.density, 0);
}
	function snapshotBaseFromCurrentPad() {
		// snapshot current pad parameters as base
		if (state.activePadIndex == null) return;
		const pad = state.padParams.get(state.activePadIndex);
		xyBaseGranular = { ...pad.granular };
		xyBaseFx = { ...pad.effects };
		// Sincronizza il riverbero con l'XYPad per controllare i simboli
		xy.setReverbMix?.(pad.effects.reverbMix);
		
		const padXY = pad.xy || { x: 0.5, y: 0.5 };
		
		// Sincronizza il filtro cutoff con l'XYPad per controllare il colore ciano
		const cutoffWeight = calculateParamWeight('filterCutoffHz', padXY);
		xy.setFilterCutoff?.(pad.effects.filterCutoffHz, cutoffWeight);
		
		// Sincronizza la densità con l'XYPad per controllare l'animazione della griglia
		const densityWeight = calculateParamWeight('density', padXY);
		xy.setDensity?.(pad.granular.density, densityWeight);
		
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
		// Update the stored XY position for the active pad
		if (state.activePadIndex != null && !isXYMorphing) {
			state.padParams.setXY(state.activePadIndex, pos);
		}
		
		// Update motion panel cursor if active
		if (motionCtrl) {
			motionCtrl.setCursor(pos.x, pos.y);
		}

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
			{ idx: idxOf(customSelectTL?.getValue() || ''), w: wTL },
			{ idx: idxOf(customSelectTR?.getValue() || ''), w: wTR },
			{ idx: idxOf(customSelectBL?.getValue() || ''), w: wBL },
			{ idx: idxOf(customSelectBR?.getValue() || ''), w: wBR }
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
		state.engine?.setEffectParams(f);
		// Aggiorna il numero di simboli nell'XYPad se cambia il reverbMix
		if (f.reverbMix != null) {
			xy.setReverbMix?.(f.reverbMix);
		}
		// Aggiorna il colore ciano se cambia il filtro cutoff (in modalità pads il peso è 0)
		if (f.filterCutoffHz != null) {
			xy.setFilterCutoff?.(f.filterCutoffHz, 0);
		}
		// Aggiorna l'animazione della griglia se cambia la densità (in modalità pads il peso è 0)
		if (g.density != null) {
			xy.setDensity?.(g.density, 0);
		}
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
		{ id: (customSelectTL?.getValue() || '') as ParamId, weight: wTL },
		{ id: (customSelectTR?.getValue() || '') as ParamId, weight: wTR },
		{ id: (customSelectBL?.getValue() || '') as ParamId, weight: wBL },
		{ id: (customSelectBR?.getValue() || '') as ParamId, weight: wBR }
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
		// Aggiorna l'animazione della griglia se cambia la densità
		if (granularUpdate.density != null) {
			// Trova il peso del vertice TR per la densità
			const densityWeight = influenceMap.get('density') ?? 0;
			xy.setDensity?.(granularUpdate.density, densityWeight);
		}
	}
	if (Object.keys(fxUpdate).length) {
		applyFxToEngine(fxUpdate);
		controls.setFxUI(fxUpdate);
		if (state.activePadIndex != null) state.padParams.setEffects(state.activePadIndex, fxUpdate);
		// Aggiorna il numero di simboli nell'XYPad se cambia il reverbMix
		if (fxUpdate.reverbMix != null) {
			xy.setReverbMix?.(fxUpdate.reverbMix);
		}
		// Aggiorna il colore ciano se cambia il filtro cutoff
		if (fxUpdate.filterCutoffHz != null) {
			// Trova il peso del vertice TL per il filtro cutoff
			const cutoffWeight = influenceMap.get('filterCutoffHz') ?? 0;
			xy.setFilterCutoff?.(fxUpdate.filterCutoffHz, cutoffWeight);
		}
	}
	refreshParamTilesFromState();
});

// ---------- Update Manager (Electron only) ----------
const updateManager = createUpdateManager();

// Show notification when update is available
updateManager.onUpdateAvailable((info) => {
	console.log('Update available:', info.version);
	// You can show a notification to the user here
	if (recordStatusEl) {
		recordStatusEl.textContent = `Update available: v${info.version}`;
		setTimeout(() => {
			recordStatusEl.textContent = '';
		}, 5000);
	}
});

// Show download progress
updateManager.onDownloadProgress((progress) => {
	const percent = Math.round(progress.percent || 0);
	if (recordStatusEl && percent > 0 && percent < 100) {
		recordStatusEl.textContent = `Downloading update: ${percent}%`;
	}
});

// Notify when update is downloaded (will auto-install on next restart)
updateManager.onUpdateDownloaded((info) => {
	console.log('Update downloaded:', info.version);
	if (recordStatusEl) {
		recordStatusEl.textContent = `Update downloaded! Restart to install v${info.version}`;
		setTimeout(() => {
			recordStatusEl.textContent = '';
		}, 10000);
	}
});

