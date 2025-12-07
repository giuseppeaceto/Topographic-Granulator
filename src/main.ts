import { createAudioContextManager } from './modules/audio/AudioContextManager';
import { createAudioRecorder } from './modules/audio/AudioRecorder';
import { loadAudioFile } from './modules/audio/AudioFileLoader';
import { createRegionStore, type Region } from './modules/editor/RegionStore';
import { createEffectsChain, type EffectsChain } from './modules/effects/EffectsChain';
import { createGranularWorkletEngine, type GranularWorkletEngine } from './modules/granular/GranularWorkletEngine';
import { VoiceManager } from './modules/audio/VoiceManager';
import { createPadGrid, PAD_ICONS } from './modules/ui/PadGrid';
import { setupControls } from './modules/ui/Controls';
import { createWaveformView } from './modules/ui/WaveformView';
import { createXYPadThree } from './modules/ui/XYPadThree';
import { createMotionPanel } from './modules/ui/MotionPanel';
import { PARAMS, type ParamId } from './modules/ui/ParamRegistry';
import { ParameterMapper } from './modules/utils/ParameterMapper';
import { MidiManager, type MidiMapping, loadMappings, saveMappings } from './modules/midi/MidiManager';
import { createPadParamStore, defaultEffects, defaultGranular } from './modules/editor/PadParamStore';
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
	voiceManager: VoiceManager | null;
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
	voiceManager: null,
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

// Pad Edit Modal Logic
const padEditModal = document.getElementById('padEditModal') as HTMLDivElement;
const padIconGrid = document.getElementById('padIconGrid') as HTMLDivElement;
const padEditCancel = document.getElementById('padEditCancel') as HTMLButtonElement;
const padEditSave = document.getElementById('padEditSave') as HTMLButtonElement;
const padEditDelete = document.getElementById('padEditDelete') as HTMLButtonElement | null;

let currentEditIndex: number | null = null;
let pendingRegionUpdate: { start: number, end: number } | null = null;
let selectedIconIndex: number | null = null;

function openPadEditModal(index: number, pendingRegion: { start: number, end: number } | null) {
	currentEditIndex = index;
	pendingRegionUpdate = pendingRegion;
	const region = state.regions.get(index);
	selectedIconIndex = region?.iconIndex ?? null;
	if (padEditDelete) {
		padEditDelete.disabled = !region;
	}
	
	padIconGrid.innerHTML = '';
	PAD_ICONS.forEach((icon, i) => {
		const div = document.createElement('div');
		div.className = 'icon-option';
		
		// Map icon index to color
		const color = PAD_COLORS[i % PAD_COLORS.length];
		div.style.color = color;
		div.style.borderColor = 'var(--border-subtle)';

		// If explicit icon set, match it.
		// If no explicit icon set, default behavior is to use index.
		// When opening modal, we want to show what IS currently used.
		// If region.iconIndex is set, use that.
		// If not, the pad is using `index % PAD_ICONS.length`.
		// Let's pre-select that if we are editing an existing assignment without custom icon.
		const effectiveIndex = region?.iconIndex !== undefined ? region.iconIndex : (region ? index % PAD_ICONS.length : null);
		const isSelected = selectedIconIndex !== null ? (selectedIconIndex === i) : (effectiveIndex === i);
		
		if (isSelected) {
			div.classList.add('selected');
			div.style.borderColor = color;
			div.style.backgroundColor = hexToRgba(color, 0.1);
			selectedIconIndex = i; // Ensure we have a selection to save if user hits save immediately
		}
        
		div.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icon}</svg>`;
		div.onclick = () => {
			document.querySelectorAll('.icon-option').forEach(el => {
				el.classList.remove('selected');
				(el as HTMLElement).style.borderColor = 'var(--border-subtle)';
				(el as HTMLElement).style.backgroundColor = '';
			});
			div.classList.add('selected');
			div.style.borderColor = color;
			div.style.backgroundColor = hexToRgba(color, 0.1);
			selectedIconIndex = i;
		};
		padIconGrid.appendChild(div);
	});

	padEditModal.classList.add('open');
    padEditModal.style.display = 'flex';
    padEditModal.setAttribute('aria-hidden', 'false');
}

function closePadEditModal() {
	padEditModal.classList.remove('open');
    setTimeout(() => {
        padEditModal.style.display = 'none';
        padEditModal.setAttribute('aria-hidden', 'true');
    }, 200);
	currentEditIndex = null;
    pendingRegionUpdate = null;
	if (padEditDelete) {
		padEditDelete.disabled = false;
	}
}

if (padEditCancel) padEditCancel.addEventListener('click', closePadEditModal);

if (padEditSave) padEditSave.addEventListener('click', () => {
	if (currentEditIndex === null) return;
    
    const existingRegion = state.regions.get(currentEditIndex);
    let region: Region;
    
    // We only care about start/end and iconIndex now. Name is preserved if existing but not editable.
    const iconIndex = selectedIconIndex !== null ? selectedIconIndex : undefined;

    if (pendingRegionUpdate) {
        region = { 
            start: pendingRegionUpdate.start, 
            end: pendingRegionUpdate.end, 
            name: existingRegion?.name, 
            iconIndex 
        };
    } else if (existingRegion) {
        region = { ...existingRegion, iconIndex };
    } else {
        closePadEditModal();
        return;
    }
    
	state.regions.set(currentEditIndex, region);
    
    // Explicitly update waveform color if this is the active pad
    if (state.activePadIndex === currentEditIndex) {
        // If we updated the active pad, ensure waveform color matches new icon
        // Use the explicitly saved iconIndex if present, otherwise fallback to pad index
        const effectiveIconIndex = region.iconIndex !== undefined ? region.iconIndex : currentEditIndex;
        const color = PAD_COLORS[effectiveIconIndex % PAD_COLORS.length];
        waveform.setColor(color, hexToRgba(color, 0.18));
        if (motionCtrl) motionCtrl.setColor(color);
        waveform.setSelection(region.start, region.end);
    }

    // Force update of pad grid immediately
    updatePadGrid();
    
    closePadEditModal();
});

function deletePad(index: number) {
	// Stop everything to avoid stale voices referencing shifted indices
	state.voiceManager?.stopAll();
	if (motionCtrl && motionCtrl.isPlaying()) {
		motionCtrl.stop();
	}

	// Remove pad data (regions + params) and shrink stores
	state.regions.remove(index);
	state.padParams.remove(index);

	// Clear MIDI mappings for this pad and shift higher indices down
	state.midi.mappings = state.midi.mappings
		.filter(m => m.targetId !== `pad:${index}`)
		.map(m => {
			if (m.targetId.startsWith('pad:')) {
				const idx = Number(m.targetId.split(':')[1]);
				if (idx > index) {
					return { ...m, targetId: `pad:${idx - 1}` };
				}
			}
			return m;
		});
	saveMappings(state.midi.mappings);

	// Adjust active pad index
	if (state.activePadIndex !== null) {
		if (state.activePadIndex === index) {
			state.activePadIndex = null;
		} else if (state.activePadIndex > index) {
			state.activePadIndex = state.activePadIndex - 1;
		}
	}

	// Clear waveform selection if no active pad
	if (state.activePadIndex === null) {
		waveform.clearSelection();
		updateSelPosUI();
		if (xy && xy.setPosition) xy.setPosition(0.5, 0.5);
	}

	updatePadGrid();
	if (getXYMode() === 'pads') {
		populateParamSelect(customSelectTL);
		populateParamSelect(customSelectTR);
		populateParamSelect(customSelectBL);
		populateParamSelect(customSelectBR);
		refreshXYCornerLabels();
	}

	closePadEditModal();
}

if (padEditDelete) {
	padEditDelete.addEventListener('click', () => {
		if (currentEditIndex === null) return;
		deletePad(currentEditIndex);
	});
}

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
        externalClock: true, // Let VoiceManager drive the animation
		onPosition: (x, y) => {
			if (xy && xy.setPosition) {
				xy.setPosition(x, y);
			}
            // If recording, we might want to update visuals, but we don't drive engine here.
		},
		onPathChange: (path) => {
			if (state.activePadIndex != null) {
				state.padParams.setMotionPath(state.activePadIndex, path);
                // Retrigger to apply new path to engine immediately
                triggerPad(state.activePadIndex);
			}
		},
		onPlayStateChange: (isPlaying) => {
            // Visual feedback only, engine handles playback
            // If user hits Play on motion panel, ensure pad is triggered?
            if (isPlaying && state.activePadIndex != null) {
                if (!state.voiceManager?.isPadPlaying(state.activePadIndex)) {
                    triggerPad(state.activePadIndex);
                }
            }
		},
        onSpeedChange: (speed) => {
             if (state.activePadIndex != null) {
                // Update store
                const current = state.padParams.get(state.activePadIndex);
                state.padParams.setMotionParams(state.activePadIndex, current.motionMode || 'loop', speed);
                // Retrigger to update engine
                triggerPad(state.activePadIndex);
             }
        }
	});

    // Listen for mode changes (Loop, PingPong...) from the DOM element directly or add callback to MotionPanel?
    // MotionPanel has internal listener but exposed `loopModeSelect`.
    const motionLoopSelect = document.getElementById('motionLoopMode') as HTMLSelectElement;
    motionLoopSelect?.addEventListener('change', () => {
         if (state.activePadIndex != null) {
            const current = state.padParams.get(state.activePadIndex);
            const mode = motionLoopSelect.value as any;
            state.padParams.setMotionParams(state.activePadIndex, mode, current.motionSpeed || 1.0);
             // Retrigger to update engine
            triggerPad(state.activePadIndex);
        }
	});

	// Stop motion playback if user interacts with main XY pad
	xyCanvas.addEventListener('pointerdown', () => {
		// if (motionCtrl && motionCtrl.isPlaying()) {
		// 	motionCtrl.stop();
		// }
        // Now handled by Manual Override logic
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

// Force XY cursor to the stored position for a pad, optionally firing change handlers
function syncXYToPad(index: number, triggerChange = false) {
	const pad = state.padParams.get(index);
	const pos = pad?.xy || { x: 0.5, y: 0.5 };
	if (!xy) return;
	if (triggerChange && xy.setPosition) {
		xy.setPosition(pos.x, pos.y);
	} else if (xy.setPositionSilent) {
		xy.setPositionSilent(pos.x, pos.y);
	}
	if (motionCtrl) {
		motionCtrl.setCursor(pos.x, pos.y);
	}
    
    // Sync Motion Panel Controls
    if (motionCtrl) {
        if (pad.motionPath) motionCtrl.setPath(pad.motionPath);
        else motionCtrl.setPath([]);
        
        // Sync Inputs
        const speedInput = document.getElementById('motionSpeed') as HTMLInputElement;
        if (speedInput) speedInput.value = String(pad.motionSpeed ?? 1.0);
        
        const loopSelect = document.getElementById('motionLoopMode') as HTMLSelectElement;
        if (loopSelect) loopSelect.value = pad.motionMode ?? 'loop';
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
			state.regions.set(state.activePadIndex, { 
                start: sel.start, 
                end: sel.end, 
                name: existing?.name,
                iconIndex: existing?.iconIndex 
            });
			updatePadGrid();
		}
		// Update engine region in real-time
		if (state.voiceManager && state.buffer && state.activePadIndex != null) {
            const voice = state.voiceManager.getActiveVoiceForPad(state.activePadIndex);
            if (voice) {
			    voice.engine.setRegion(sel.start, sel.end);
			    // ensure immediate response while dragging
			    voice.engine.trigger();
            }
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
            // Stop audio for this pad
            if (state.voiceManager) {
                state.voiceManager.stopPad(state.activePadIndex);
            }
            // Stop motion playback if active
            if (motionCtrl && motionCtrl.isPlaying()) {
                motionCtrl.stop();
            }
            
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
				// Aggiorna lo stato attivo come se avessimo premuto il pad nella UI
				const prevIndex = state.activePadIndex;
				state.activePadIndex = index;
				snapshotBaseFromCurrentPad();

				if (state.recallPerPad) {
					recallPadParams(index, 0, prevIndex ?? null);
					const region = state.regions.get(index);
					const effectiveIndex = region?.iconIndex !== undefined ? region.iconIndex : index;
					const c = PAD_COLORS[effectiveIndex % PAD_COLORS.length];
					waveform.setColor(c, hexToRgba(c, 0.18));
				} else {
					recallWaveformSelection(index);
				}
				updateSelPosUI();

				triggerPad(index);
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
            
            // If the first pad is not assigned, assign the full buffer to it
            if (!state.regions.get(0)) {
                state.regions.set(0, { start: 0, end: loaded.audioBuffer.duration, name: 'Full' });
            }

			// Also ensure we are synced with this pad's parameters
			recallPadParams(0, 0); 
		}
		updatePadGrid();
		waveform.setBuffer(loaded.audioBuffer);
		bufferDurEl.textContent = `Duration: ${loaded.audioBuffer.duration.toFixed(2)}s`;
		updateSelPosUI();
		
		if (state.voiceManager) {
			console.log('Setting buffer to engine...');
			try {
				await state.voiceManager.setBuffer(loaded.audioBuffer);
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

async function ensureEngine() {
	if (!state.voiceManager) {
		try {
			state.voiceManager = new VoiceManager(state.contextMgr.audioContext, 4);
			ensureEffects();
			await state.voiceManager.init(state.effects!.input, (index) => state.padParams.get(index));
			
			if (state.buffer) {
				await state.voiceManager.setBuffer(state.buffer);
			}
		} catch (err) {
			console.error('VoiceManager error:', err);
			throw err;
		}
	}
}

function ensureEffects() {
	if (!state.effects) {
		state.effects = createEffectsChain(state.contextMgr.audioContext);
		// state.engine no longer exists here. VoiceManager connects voices to destination directly (or effects input)
        // But wait, VoiceManager needs to connect to effects input if we want to record!
        // In init(), we passed state.effects.input.
        // But ensureEffects is called BEFORE init usually.
        // Ah, ensureEffects creates state.effects.
        // VoiceManager init takes destination.
        
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

// Helper to get params for a pad (or defaults)
function getPadParams(index: number) {
	return state.padParams.get(index);
}

function applyFxToEngine(patch: Partial<EffectsParams>) {
	// This function is now primarily for updating the UI/State
    // VoiceManager handles applying FX to voices during trigger/update
	const base = getActiveFxParams();
	const merged = { ...base, ...patch };
	if (state.activePadIndex != null) {
		state.padParams.setEffects(state.activePadIndex, merged);
        // Update active voice if any
        const voice = state.voiceManager?.getActiveVoiceForPad(state.activePadIndex);
        if (voice) {
            voice.engine.setEffectParams(merged);
        }
	}
	return merged;
}

const PAD_COLORS = ['#A1E34B', '#66D9EF', '#FDBC40', '#FF7AA2', '#7C4DFF', '#00E5A8', '#F06292', '#FFD54F'];

function updatePadGrid() {
	padGridEl.innerHTML = '';
	const padGrid = createPadGrid(padGridEl, state.regions.getAll(), { colors: PAD_COLORS, activeIndex: state.activePadIndex, maxPads: 3 });
	padGrid.onAdd = () => {
		if (state.regions.getAll().length >= 3) return;
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

		// POLYPHONY: Do NOT stop other pads when switching focus.
		// state.voiceManager?.stopAll(); 
        
        // IMPORTANT: Snapshot base parameters from the new pad immediately
		snapshotBaseFromCurrentPad();
		// Re-align XY cursor to this pad so levels/mix start from the saved position
		syncXYToPad(index, true);
		
		// If smooth recall is enabled, handle everything in recallPadParams
		if (state.recallPerPad) {
			recallPadParams(index, 300, prevIndex);
			// Colorize waveform selection based on pad (visual only, selection moves in recallPadParams)
			const region = state.regions.get(index);
			const effectiveIndex = region?.iconIndex !== undefined ? region.iconIndex : index;
			const c = PAD_COLORS[effectiveIndex % PAD_COLORS.length];
			waveform.setColor(c, hexToRgba(c, 0.18));
            if (motionCtrl) motionCtrl.setColor(c);
			
			// Ensure engine is running IF it's not already playing
			if (state.voiceManager && state.buffer) {
                // Only trigger if not already playing to allow seamless "focus switching"
                if (!state.voiceManager.isPadPlaying(index)) {
                triggerPad(index);
                }
			}

            // Start motion playback if exists (after a short delay to let recall start?)
            // Or just start it. recallPadParams will set the path. 
            // We need to explicitly tell motionCtrl to play.
            const padParams = state.padParams.get(index);
            if (padParams?.motionPath && padParams.motionPath.length > 0 && motionCtrl) {
                // VISUALIZATION UPDATE ONLY
                // The visualization loop handles cursor position.
                // We just ensure the path is loaded.
                motionCtrl.setPath(padParams.motionPath);
            }

		} else {
			// Instant recall behavior
			const region = state.regions.get(index);
			const effectiveIndex = region?.iconIndex !== undefined ? region.iconIndex : index;
			const c = PAD_COLORS[effectiveIndex % PAD_COLORS.length];
			waveform.setColor(c, hexToRgba(c, 0.18));
            if (motionCtrl) motionCtrl.setColor(c);
			recallWaveformSelection(index);
			updateSelPosUI();
			
			if (region && state.buffer) {
                 if (!state.voiceManager?.isPadPlaying(index)) {
                    triggerPad(index);
                 }
            }

            // Also load and play motion path
            const padParams = state.padParams.get(index);
            if (motionCtrl) {
                if (padParams?.motionPath) {
                    motionCtrl.setPath(padParams.motionPath);
                    // VISUALIZATION handled by loop, no need to call play()
                } else {
                    motionCtrl.setPath([]);
                }
            }
		}
	};
	padGrid.onPadLongPress = (index) => {
		if (state.midi?.learnEnabled) {
			state.midi.pendingTarget = `pad:${index}`;
			highlightPending(state.midi.pendingTarget);
			return;
		}
		// POLYPHONY: Do not stop others on edit
		// state.voiceManager?.stopAll();

		const prevIndex = state.activePadIndex;
		state.activePadIndex = index;
        
        // IMPORTANT: Snapshot base parameters from the new pad immediately
		snapshotBaseFromCurrentPad();
		
		// colorize waveform for this pad
		const region = state.regions.get(index);
		const effectiveIndex = region?.iconIndex !== undefined ? region.iconIndex : index;
		const c = PAD_COLORS[effectiveIndex % PAD_COLORS.length];
		waveform.setColor(c, hexToRgba(c, 0.18));
        if (motionCtrl) motionCtrl.setColor(c);
		
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
			openPadEditModal(index, { start: sel.start, end: sel.end });
		} else if (state.regions.get(index)) {
			// Edit existing pad without changing region
			openPadEditModal(index, null);
		}
		// Re-align XY cursor to this pad so levels/mix start from the saved position
		syncXYToPad(index, true);
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
}

async function triggerRegion(region: Region) {
	if (!state.buffer || !state.voiceManager) return;
	await state.voiceManager.setBuffer(state.buffer); // Optimization: only if buffer changed? VoiceManager handles logic
    
    // This function is called by MIDI or other triggers that aren't "Pad Press"
    // We need to find WHICH pad corresponds to this region?
    // Or is this function called with a region object from a pad?
    // Look at usage:
    // Line 559: const region = state.regions.get(index); ... triggerRegion(region);
    // So we know the index. We should pass the index to triggerRegion.
    
    // But wait, triggerRegion signature is just (region: Region).
    // I should update it to accept index.
}

// Updated signature
async function triggerPad(index: number) {
    if (!state.buffer || !state.voiceManager) return;
    const region = state.regions.get(index);
    if (!region) return;
    
    // Check if pad is already playing, if so stop it (toggle behavior) or just stop previous instances (retrigger behavior)
    // Let's implement retrigger behavior (monophonic per pad): stop old instance, start new.
    // This prevents "layering" the same pad on itself.
    if (state.voiceManager.isPadPlaying(index)) {
        state.voiceManager.stopPad(index);
    }
    
    const params = state.padParams.get(index);
    
    // Calculate corner mapping for automation
    const corners = {
        tl: customSelectTL?.getValue() || '',
        tr: customSelectTR?.getValue() || '',
        bl: customSelectBL?.getValue() || '',
        br: customSelectBR?.getValue() || ''
    };

    // Resolve pad parameters for corners if in Pad Mode
    let padMorphIndices = undefined;
    if (getXYMode() === 'pads') {
        const getPadIdFromCorner = (cornerVal: string) => {
            if (cornerVal.startsWith('pad:')) {
                return Number(cornerVal.split(':')[1]);
            }
            return null;
        };
        
        padMorphIndices = {
            tl: getPadIdFromCorner(customSelectTL?.getValue() || ''),
            tr: getPadIdFromCorner(customSelectTR?.getValue() || ''),
            bl: getPadIdFromCorner(customSelectBL?.getValue() || ''),
            br: getPadIdFromCorner(customSelectBR?.getValue() || '')
        };
    }

    state.voiceManager.trigger(
        index,
        region,
        params.granular,
        params.effects,
        params.xy || { x: 0.5, y: 0.5 },
        params.motionPath,
        params.motionMode || 'loop',
        params.motionSpeed || 1.0,
        corners,
        padMorphIndices
    );
}

// ---------- VISUALIZATION LOOP ----------
// Sync UI with Audio Engine state (Active Pad only)
function startVisualizationLoop() {
    const loop = () => {
        if (state.voiceManager) {
            // 1. Update Ghost Cursors (Background Polyphony)
            if (xy.setGhostPositions) {
                const allPositions = state.voiceManager.getAllVoicePositions();
                // Filter out the active pad from ghosts (it has the main cursor)
                const ghosts = allPositions.filter(p => p.colorIndex !== state.activePadIndex);
                xy.setGhostPositions(ghosts);
            }

            // 2. Update Active Pad Cursor & Visuals
            if (state.activePadIndex != null) {
                const pos = state.voiceManager.getVoiceCurrentXY(state.activePadIndex);
                
                if (pos) {
                    // Update XY Pad Cursor (Silent update to avoid feedback loop)
                    // Only if user is NOT dragging (Manual Override handles its own UI update)
                    if (!xyUserDragging && xy.setPositionSilent) {
                        xy.setPositionSilent(pos.x, pos.y);
                    }

                    // Update Motion Panel Cursor
                    if (motionCtrl) {
                        motionCtrl.setCursor(pos.x, pos.y);
                    }
                    
                    // Update Param Knobs / Visuals based on current position
                    if (!xyUserDragging) {
                         updateVisualsFromXY(pos.x, pos.y);
                    }
                }
            }
        }
        requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
}

// Helper to update UI visuals (Knobs, Colors) based on XY position
// Extracted from the old xy.onChange
function updateVisualsFromXY(x: number, y: number) {
    if (state.activePadIndex == null) return;
    
    // Ensure base snapshot exists
    if (xyBaseGranular == null || xyBaseFx == null) {
        snapshotBaseFromCurrentPad();
    }
    if (!xyBaseGranular || !xyBaseFx) return;

    const mode = getXYMode();
    
    if (mode === 'pads') {
        // (Pads mode visualization logic - simplified or same as before)
        // ... for now skip detailed visual updates for pads mode in loop to save perf, 
        // or just rely on the fact that pads mode usually doesn't have "Base Params" in the same way.
        // Let's implement basic param update if needed, but for now leave blank or copy logic.
        return; 
    }

    // Params Mode Visualization
    
    // 1. Calculate Weights
    const weights = ParameterMapper.calculateWeights(x, y);
    
    // 2. Map Parameters using shared logic
    const cornerMapping = {
        tl: customSelectTL?.getValue() || '',
        tr: customSelectTR?.getValue() || '',
        bl: customSelectBL?.getValue() || '',
        br: customSelectBR?.getValue() || ''
    };
    
    const baseParams = {
        granular: xyBaseGranular,
        effects: xyBaseFx,
        selectionPos: xyBaseSelectionPos ?? 0
    };

    const { granular: granularUpdate, effects: fxUpdate } = ParameterMapper.mapParams(
        weights,
        baseParams,
        cornerMapping
    );
    
    // 3. Update Knobs UI
    controls.setGranularUI(granularUpdate);
    controls.setFxUI(fxUpdate);
    refreshParamTilesFromState(); // Updates the knobs rotation
    
    // 4. Update XY Pad Visuals (Density, Color, Reverb)
    // We need to know "influence" for specific parameters for visual cues
    // Re-calculate basic influence locally just for these 3 specific visuals 
    // (Optimization: could expose influence map from Mapper if needed, but this is fast enough)
    
    // Helper to sum weights for a specific param ID from corners
    const getInfluence = (id: string) => {
        let sum = 0;
        if (cornerMapping.tl === id) sum += weights.tl;
        if (cornerMapping.tr === id) sum += weights.tr;
        if (cornerMapping.bl === id) sum += weights.bl;
        if (cornerMapping.br === id) sum += weights.br;
        return sum;
    };

    if (granularUpdate.density != null) {
         const densityWeight = getInfluence('density');
         xy.setDensity?.(granularUpdate.density, densityWeight);
    }
    if (fxUpdate.reverbMix != null) {
        xy.setReverbMix?.(fxUpdate.reverbMix);
    }
    if (fxUpdate.filterCutoffHz != null) {
        const cutoffWeight = getInfluence('filterCutoffHz');
        xy.setFilterCutoff?.(fxUpdate.filterCutoffHz, cutoffWeight);
    }
}

startVisualizationLoop();

const controls = setupControls({
	onParams: (params) => {
		ensureEngine();
		// persist to active pad
		if (state.activePadIndex != null) {
			state.padParams.setGranular(state.activePadIndex, params as GranularParams);
            // Update active voice
            const voice = state.voiceManager?.getActiveVoiceForPad(state.activePadIndex);
            if (voice) voice.engine.setParams(params);
		}
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
		
        // Sync Motion Panel State
        if (motionCtrl) {
            // Load Path
            if (target.motionPath) {
            motionCtrl.setPath(target.motionPath);
            } else {
            motionCtrl.setPath([]);
            }
            
            // Check if this pad is currently playing a motion path
            // And ensure motion path exists (otherwise playing makes no sense)
            const isVoiceActive = state.voiceManager?.isPadPlaying(index) ?? false;
            const hasPath = target.motionPath && target.motionPath.length > 0;
            const shouldBePlaying = isVoiceActive && hasPath;

            // Sync UI state
            motionCtrl.setPlaybackState(shouldBePlaying ? true : false);
        }

		const targetXY = target.xy || { x: 0.5, y: 0.5 };

		// If duration is 0 or very short, skip interpolation and set immediately (optimizes manual pad switch)
		if (durationMs < 16) {
			const region = state.regions.get(index);
			const safeRegion = region ? { start: region.start, end: region.end } : { start: 0, end: state.buffer?.duration || 0 };
			
            // Update ACTIVE voice if exists (for visual feedback? No, for sound)
            const voice = state.voiceManager?.getActiveVoiceForPad(index);
            if (voice) {
                voice.engine.setAllParams(target.granular, target.effects, safeRegion);
            }
			
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
            const voice = state.voiceManager?.getActiveVoiceForPad(index);
            if (voice) {
			    voice.engine.setAllParams(interpG, interpFx, interpRegion);
            }
			
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
// Track manual drag on XY pad to allow overriding motion automation safely
let xyUserDragging = false;
if (xyCanvas) {
	xyCanvas.addEventListener('pointerdown', () => { xyUserDragging = true; });
	const stopDrag = () => { xyUserDragging = false; };
	xyCanvas.addEventListener('pointerup', stopDrag);
	xyCanvas.addEventListener('pointerleave', stopDrag);
	xyCanvas.addEventListener('pointercancel', stopDrag);
}

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

// Helper to update granular params on active voice
function updateActiveVoiceGranular(p: Partial<GranularParams>) {
    const voice = state.activePadIndex != null ? state.voiceManager?.getActiveVoiceForPad(state.activePadIndex) : null;
    if (voice) {
        voice.engine.setParams(p);
    }
}

const knobConfigs: KnobConfig[] = [
	{
		id: 'pitch', min: -12, max: 12, step: 1,
		get: () => (state.padParams.get(state.activePadIndex ?? 0).granular.pitchSemitones),
		set: (v) => {
			const p: any = { pitchSemitones: Math.round(v) };
			updateActiveVoiceGranular(p);
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
			updateActiveVoiceGranular(p);
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
			updateActiveVoiceGranular(p);
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
			updateActiveVoiceGranular(p);
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
        
        // Deep copy to prevent reference issues if pad params are mutated elsewhere
		xyBaseGranular = JSON.parse(JSON.stringify(pad.granular));
		xyBaseFx = JSON.parse(JSON.stringify(pad.effects));
		
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
        // MANUAL OVERRIDE LOGIC
		if (state.activePadIndex != null) {
            // 1. Tell Audio Engine we are manually overriding position
            // This ensures audio reacts immediately to dragging
            // CRITICAL FIX: Only trigger override if USER is actually dragging.
            // Programmatic updates (like syncXYToPad) should NOT lock the voice.
            if (xyUserDragging) {
                state.voiceManager?.setVoiceManualOverride(state.activePadIndex, true, pos.x, pos.y);
            }
            
            // 2. Update Store (so state persists)
            if (!isXYMorphing) {
			state.padParams.setXY(state.activePadIndex, pos);
            }
		}
		
		// 3. Update Motion Panel Cursor (Visual only)
		if (motionCtrl) {
			motionCtrl.setCursor(pos.x, pos.y);
		}

        // 4. Update Param Visuals (Knobs, Colors)
        updateVisualsFromXY(pos.x, pos.y);
        
        // Note: We don't need to manually interpolate params here anymore
        // because updateVisualsFromXY handles the UI
        // and VoiceManager internal loop handles the Audio params (via setVoiceManualOverride).
    });

    // Reset override when drag ends
    if (xyCanvas) {
        const resetOverride = () => {
            if (state.activePadIndex != null) {
                state.voiceManager?.setVoiceManualOverride(state.activePadIndex, false);
            }
            xyUserDragging = false;
        };
        xyCanvas.addEventListener('pointerup', resetOverride);
        xyCanvas.addEventListener('pointerleave', resetOverride);
        xyCanvas.addEventListener('pointercancel', resetOverride);
    }

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
