import { createAudioContextManager } from './modules/audio/AudioContextManager';
import { createAudioRecorder } from './modules/audio/AudioRecorder';
import { loadAudioFile } from './modules/audio/AudioFileLoader';
import { createRegionStore, type Region } from './modules/editor/RegionStore';
import { createEffectsChain, type EffectsChain } from './modules/effects/EffectsChain';
import { createGranularWorkletEngine, type GranularWorkletEngine } from './modules/granular/GranularWorkletEngine';
import { VoiceManager } from './modules/audio/VoiceManager';
import { createPadGrid } from './modules/ui/PadGrid';
import { setupControls } from './modules/ui/Controls';
import { createWaveformView } from './modules/ui/WaveformView';
import { createXYPadThree } from './modules/ui/XYPadThree';
import { createMotionPanel } from './modules/ui/MotionPanel';
import { PARAMS, type ParamId } from './modules/ui/ParamRegistry';
import { ParameterMapper } from './modules/utils/ParameterMapper';
import { loadMappings } from './modules/midi/MidiManager';
import { createPadParamStore, defaultEffects, defaultGranular, type PadParams } from './modules/editor/PadParamStore';
import { defaultMarkerSeq, clearMarkers, isDiscreteGrainMode, shiftMarkersWithRegion, setMarkerHold, setMarkerDrift, markerHold, markerDriftMs, markerDriftHz, type MarkerSeqParams } from './modules/editor/MarkerStore';
import { createMarkerSequencer } from './modules/audio/MarkerSequencer';
import { createMarkerRack } from './modules/ui/MarkerRack';
import { initSidebarNav } from './modules/ui/SidebarNav';
import type { GranularParams } from './modules/granular/GranularWorkletEngine';
import type { EffectsParams } from './modules/effects/EffectsChain';
import { createCustomSelect, type SelectOption } from './modules/ui/CustomSelect';
import { createThemeManager } from './modules/ui/ThemeManager';
import { logger } from './modules/utils/logger';
import { createGamepadManager } from './modules/input/GamepadManager';
import { createFxVisualizer } from './modules/ui/FxVisualizer';
import { createPadVisualizer } from './modules/ui/PadVisualizer';
import { SCALES, quantizePitch } from './modules/utils/ScaleQuantizer';
import { createAppContext, bindAppHost, MAX_PADS, PAD_COLORS, type AppState } from './modules/app/AppContext';
import { initAppBoot } from './modules/app/AppBoot';
import { createParamTiles } from './modules/ui/ParamTiles';
import { createSessionController } from './modules/session/SessionController';
import { createPadActions } from './modules/editor/PadActions';
import { createMidiApp } from './modules/midi/MidiApp';

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
	midi: { manager: null, mappings: loadMappings(), learnEnabled: false, pendingTarget: null },
	activeScaleIndex: 0,
	midiMode: 'pads',
	audioName: null,
	audioPath: null
};

const fileInput = document.getElementById('fileInput') as HTMLInputElement;
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
const markerSequencer = createMarkerSequencer({
	getAudioContext: () => state.contextMgr.audioContext,
	onTick: ({ padIndex, marker, grainMode }) => {
		if (!state.voiceManager) return;
		state.voiceManager.setVoiceGrainAnchor(padIndex, marker.timeSec, true);
		// Glide interpolations only move the cloud; marker arrivals (and Cloud/Pulse) spawn now
		// so the step is on the beat. FX delay stays the rack delay — no extra sequencer latency.
		if ((grainMode === 'glide' && marker.id === 'glide') || marker.id === 'drift') {
			state.voiceManager.setVoiceAutoSpawn(padIndex, true);
			return;
		}
		if (isDiscreteGrainMode(grainMode)) {
			state.voiceManager.setVoiceAutoSpawn(padIndex, false);
			state.voiceManager.spawnVoiceGrain(padIndex, 1);
		} else {
			state.voiceManager.setVoiceAutoSpawn(padIndex, true);
			state.voiceManager.spawnVoiceGrain(padIndex, 1);
		}
	},
	onActiveMarker: (padIndex, markerId) => {
		if (padIndex === state.activePadIndex) {
			waveform.setActiveMarkerId(markerId);
		}
	},
	onLaneStop: (padIndex) => {
		state.voiceManager?.resetVoiceGrainSource(padIndex);
		if (padIndex === state.activePadIndex) {
			waveform.setActiveMarkerId(null);
			waveform.setPlaybackVisual(null, null);
		}
		updateSidebarStatus();
	},
	onDensity: (padIndex, density) => {
		state.voiceManager?.setVoiceDensity(padIndex, density);
	}
});
const recallPerPadEl = document.getElementById('recallPerPad') as HTMLInputElement;
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
const sidebarNav = initSidebarNav();
const fxVisualizerCanvas = document.getElementById('fxVisualizerCanvas') as HTMLCanvasElement | null;
const fxVisualizer = fxVisualizerCanvas ? createFxVisualizer(fxVisualizerCanvas) : null;
const padVisualizerCanvas = document.getElementById('padVisualizerCanvas') as HTMLCanvasElement | null;
const padVisualizerMeta = document.getElementById('padVisualizerMeta');
const padVisualizer = padVisualizerCanvas
	? createPadVisualizer(padVisualizerCanvas, padVisualizerMeta)
	: null;
const sidebarStatusPadEl = document.getElementById('sidebarStatusPad');
const sidebarStatusSeqEl = document.getElementById('sidebarStatusSeq');
const themeToggleBtn = document.getElementById('themeToggle') as HTMLButtonElement;

// Initialize Theme Manager
const themeManager = createThemeManager();
themeManager.init();
const ctx = createAppContext({
	state,
	waveform,
	xy,
	markerSequencer,
	sidebarNav,
	fxVisualizer,
	padVisualizer,
	themeManager,
	themeToggleBtn
});

function openPadEditModal(index: number, pendingRegion: { start: number, end: number } | null) {
	ctx.pads!.openEditModal(index, pendingRegion);
}
function deletePad(index: number) {
	ctx.pads!.deletePad(index);
}

// Motion panel initialization
let motionCtrl: ReturnType<typeof createMotionPanel> | null = null;
const motionCanvas = document.getElementById('motionCanvas') as HTMLCanvasElement;
if (motionCanvas) {

	motionCtrl = createMotionPanel({
		canvas: document.getElementById('motionCanvas') as HTMLCanvasElement,
		cursor: document.getElementById('motionCursor') as HTMLElement,
		recordBtn: document.getElementById('motionRecordBtn') as HTMLButtonElement | undefined,
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
				pushUndo();
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
            // Update button fill visual
            const motionPlayBtn = document.getElementById('motionPlayBtn') as HTMLButtonElement;
            if (motionPlayBtn) {
                const fill = motionPlayBtn.querySelector('.knob-fill') as HTMLElement | null;
                const valEl = motionPlayBtn.closest('.param-tile')?.querySelector('.tile-value:not([data-val])') as HTMLElement | null;
                if (fill) fill.style.height = isPlaying ? '100%' : '0%';
                if (valEl) valEl.textContent = isPlaying ? '1' : '0';
            }
		},
        onSpeedChange: (speed) => {
             if (state.activePadIndex != null) {
                // Update store
                const current = state.padParams.get(state.activePadIndex);
                state.padParams.setMotionParams(state.activePadIndex, current.motionMode || 'loop', speed);
                // Update voice directly without retrigger to preserve manual override state
                if (state.voiceManager?.isPadPlaying(state.activePadIndex)) {
                    state.voiceManager.setVoiceMotionSpeed(state.activePadIndex, speed);
                } else {
                    // Only trigger if pad is not playing
                    triggerPad(state.activePadIndex);
                }
             }
        }
	});
	ctx.motionCtrl = motionCtrl;

    // Listen for mode changes (Loop, PingPong...) from the DOM element directly or add callback to MotionPanel?
    // MotionPanel has internal listener but exposed `loopModeSelect`.
    const motionLoopSelect = document.getElementById('motionLoopMode') as HTMLSelectElement;
    const motionLoopOptions = ['loop', 'pingpong', 'oneshot', 'reverse'];
    const motionLoopLabels = ['Loop', 'PingPong', 'OneShot', 'Reverse'];
    
    // Update option selector visual
    const updateMotionLoopSelector = () => {
        const selectorEl = document.querySelector('.option-selector[data-selector="motion-loop"]') as HTMLElement | null;
        const labelEl = selectorEl?.querySelector('.option-selector-label[data-label="motion-loop"]') as HTMLElement | null;
        if (selectorEl && labelEl && motionLoopSelect) {
            const currentIdx = motionLoopOptions.indexOf(motionLoopSelect.value);
            if (currentIdx >= 0) {
                labelEl.textContent = motionLoopLabels[currentIdx];
            }
        }
    };
    
    motionLoopSelect?.addEventListener('change', () => {
         if (state.activePadIndex != null) {
            const current = state.padParams.get(state.activePadIndex);
            const mode = motionLoopSelect.value as any;
            state.padParams.setMotionParams(state.activePadIndex, mode, current.motionSpeed || 1.0);
            // Update voice directly without retrigger to preserve manual override state
            if (state.voiceManager?.isPadPlaying(state.activePadIndex)) {
                state.voiceManager.setVoiceMotionMode(state.activePadIndex, mode);
            } else {
                // Only trigger if pad is not playing
                triggerPad(state.activePadIndex);
            }
        }
        updateMotionLoopSelector();
	});
    
    // Initialize option selector buttons
    const motionLoopSelector = document.querySelector('.option-selector[data-selector="motion-loop"]');
    if (motionLoopSelector) {
        const prevBtn = motionLoopSelector.querySelector('[data-direction="prev"]') as HTMLElement;
        const nextBtn = motionLoopSelector.querySelector('[data-direction="next"]') as HTMLElement;
        
        const changeMotionLoop = (direction: 'prev' | 'next') => {
            if (!motionLoopSelect) return;
            const currentIdx = motionLoopOptions.indexOf(motionLoopSelect.value);
            let newIdx = direction === 'next' ? currentIdx + 1 : currentIdx - 1;
            if (newIdx < 0) newIdx = motionLoopOptions.length - 1;
            if (newIdx >= motionLoopOptions.length) newIdx = 0;
            motionLoopSelect.value = motionLoopOptions[newIdx];
            motionLoopSelect.dispatchEvent(new Event('change'));
        };
        
        prevBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            changeMotionLoop('prev');
        });
        
        nextBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            changeMotionLoop('next');
        });
        
        // Initialize display
        updateMotionLoopSelector();
    }

    // Motion Speed input handler
    const motionSpeedInput = document.getElementById('motionSpeed') as HTMLInputElement;
    motionSpeedInput?.addEventListener('input', () => {
        const val = parseFloat(motionSpeedInput.value);
        if (state.activePadIndex != null) {
            const current = state.padParams.get(state.activePadIndex);
            state.padParams.setMotionParams(state.activePadIndex, current.motionMode || 'loop', val);
            // Update voice directly without retrigger to preserve manual override state
            if (state.voiceManager?.isPadPlaying(state.activePadIndex)) {
                state.voiceManager.setVoiceMotionSpeed(state.activePadIndex, val);
            } else {
                // Only trigger if pad is not playing
                triggerPad(state.activePadIndex);
            }
        }
        // Update knob visual
        const knobEl = document.querySelector('.knob[data-knob="motion-speed"]') as HTMLElement | null;
        const valEl = document.querySelector('.tile-value[data-val="motion-speed"]') as HTMLElement | null;
        if (knobEl && valEl) {
            const cfg = ctx.tiles?.findConfig('motion-speed');
            if (cfg) {
                valEl.textContent = cfg.format(val);
                updateKnobAngle(knobEl, val, cfg);
                updateValueDisplay(cfg, val);
            }
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
	
	// Sync XY Pad speeds from pad params
	const normalSpeed = pad?.xySpeed ?? 0.15;
	const shiftSpeed = pad?.xyShift ?? 0.05;
	xy.setSpeed?.(normalSpeed, shiftSpeed);
	
	// Update knob visuals to reflect saved values
	const xyspeedKnob = document.querySelector('.knob[data-knob="xyspeed"]') as HTMLElement | null;
	const xyshiftKnob = document.querySelector('.knob[data-knob="xyshift"]') as HTMLElement | null;
	if (xyspeedKnob) {
		const cfg = ctx.tiles?.findConfig('xyspeed');
		if (cfg) {
			updateKnobAngle(xyspeedKnob, normalSpeed, cfg);
			const valEl = xyspeedKnob.closest('.param-tile')?.querySelector('.tile-value[data-val="xyspeed"]') as HTMLElement | null;
			if (valEl) valEl.textContent = cfg.format(normalSpeed);
		}
	}
	if (xyshiftKnob) {
		const cfg = ctx.tiles?.findConfig('xyshift');
		if (cfg) {
			updateKnobAngle(xyshiftKnob, shiftSpeed, cfg);
			const valEl = xyshiftKnob.closest('.param-tile')?.querySelector('.tile-value[data-val="xyshift"]') as HTMLElement | null;
			if (valEl) valEl.textContent = cfg.format(shiftSpeed);
		}
	}
}
// Flag to prevent saving selection to pad during XY morphing
let isXYMorphing = false;
let isMarkerPlayback = false;
let skipNextMarkerShift = false;
let markersLiveShifted = false;
waveform.onSelection((sel) => {
	if (sel) {
		selStartEl.textContent = sel.start.toFixed(2);
		selEndEl.textContent = sel.end.toFixed(2);
		updateSelPosUI();
		// Persist selection to active pad as its region (non-destructive: preserve name)
		// BUT NOT during XY pad morphing (would interfere with morphing)
		if (state.activePadIndex != null && !isXYMorphing && !isMarkerPlayback) {
			const existing = state.regions.get(state.activePadIndex);
			if (!skipNextMarkerShift && existing && state.buffer) {
				const seq = getMarkerSeq(state.activePadIndex);
				const shifted = shiftMarkersWithRegion(seq.markers, existing, sel, state.buffer.duration);
				if (shifted !== seq.markers) {
					state.padParams.setMarkerSeq(state.activePadIndex, { markers: shifted });
					waveform.setMarkers(shifted);
				}
			}
			skipNextMarkerShift = false;
			state.regions.set(state.activePadIndex, { 
                start: sel.start, 
                end: sel.end, 
                name: existing?.name,
                iconIndex: existing?.iconIndex 
            });
			updatePadGrid();
			waveform.setRegionRange({ start: sel.start, end: sel.end });
			syncMarkerEngine(state.activePadIndex);
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

// ---------- Audio/Video Recording ----------

let isVideoRecording = false;

function updateRecordingUI() {
	if (!state.recorder) return;
	const isRecording = state.recorder.isRecording();
	recordBtn.disabled = isRecording;
	recordVideoBtn.disabled = isRecording;
	stopRecordBtn.disabled = !isRecording;
	
	// Update button fill visuals
	const updateBtnFill = (btn: HTMLButtonElement, active: boolean) => {
		const fill = btn.querySelector('.knob-fill') as HTMLElement | null;
		const valEl = btn.closest('.param-tile')?.querySelector('.tile-value:not([data-val])') as HTMLElement | null;
		if (fill) fill.style.height = active ? '100%' : '0%';
		if (valEl) valEl.textContent = active ? '1' : '0';
	};
	
	if (isRecording) {
		const duration = state.recorder.getDuration();
		const mins = Math.floor(duration / 60);
		const secs = Math.floor(duration % 60);
		const mode = isVideoRecording ? 'Video' : 'Audio';
		recordStatusEl.textContent = `● ${mode}: ${mins}:${secs.toString().padStart(2, '0')}`;
		recordStatusEl.classList.add('active');
		// Keep active button filled
		updateBtnFill(isVideoRecording ? recordVideoBtn : recordBtn, true);
	} else {
		recordStatusEl.textContent = 'Ready';
		recordStatusEl.classList.remove('active');
		isVideoRecording = false;
		updateBtnFill(recordBtn, false);
		updateBtnFill(recordVideoBtn, false);
	}
	updateSidebarStatus();
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
		// Update button fill visual
		const fill = recordBtn.querySelector('.knob-fill') as HTMLElement | null;
		const valEl = recordBtn.closest('.param-tile')?.querySelector('.tile-value:not([data-val])') as HTMLElement | null;
		if (fill) fill.style.height = '100%';
		if (valEl) valEl.textContent = '1';
		// Update UI every second
		state.recordingTimer = setInterval(() => {
			updateRecordingUI();
		}, 1000) as any as number;
	} catch (error) {
		logger.error('Error starting recording:', error);
		recordStatusEl.textContent = 'Error starting recording';
		recordStatusEl.classList.remove('active');
	}
});

recordVideoBtn.addEventListener('click', async () => {
	ensureEffects();
	if (!state.recorder) return;
	try {
		await state.recorder.start(true); // Video + Audio
		isVideoRecording = true;
		updateRecordingUI();
		// Update button fill visual
		const fill = recordVideoBtn.querySelector('.knob-fill') as HTMLElement | null;
		const valEl = recordVideoBtn.closest('.param-tile')?.querySelector('.tile-value:not([data-val])') as HTMLElement | null;
		if (fill) fill.style.height = '100%';
		if (valEl) valEl.textContent = '1';
		// Update UI every second
		state.recordingTimer = setInterval(() => {
			updateRecordingUI();
		}, 1000) as any as number;
	} catch (error) {
		logger.error('Error starting video recording:', error);
		if ((error as Error).message === 'PermissionDenied' || (error as any).name === 'NotAllowedError' || (error as any).name === 'AbortError') {
			showPermissionHelp();
			recordStatusEl.textContent = 'Permission denied';
		} else {
			recordStatusEl.textContent = 'Error starting video recording';
		}
		recordStatusEl.classList.remove('active');
		setTimeout(() => {
			recordStatusEl.textContent = 'Ready';
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
	// Update button fills - clear all recording buttons
	[recordBtn, recordVideoBtn].forEach(btn => {
		const fill = btn.querySelector('.knob-fill') as HTMLElement | null;
		const valEl = btn.closest('.param-tile')?.querySelector('.tile-value:not([data-val])') as HTMLElement | null;
		if (fill) fill.style.height = '0%';
		if (valEl) valEl.textContent = '0';
	});
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
		recordStatusEl.classList.remove('active');
		setTimeout(() => {
			recordStatusEl.textContent = 'Ready';
		}, 3000);
	}
});

if (recallPerPadEl) {
	recallPerPadEl.checked = true;
	recallPerPadEl.addEventListener('change', () => {
		state.recallPerPad = recallPerPadEl.checked;
		// Update knob visual
		const knobEl = document.querySelector('.knob[data-knob="recall"]') as HTMLElement | null;
		const valEl = document.querySelector('.tile-value[data-val="recall"]') as HTMLElement | null;
		if (knobEl && valEl) {
			const cfg = ctx.tiles?.findConfig('recall');
			if (cfg) {
				const value = state.recallPerPad ? 1 : 0;
				valEl.textContent = cfg.format(value);
				if (knobEl.classList.contains('toggle-switch-knob')) {
					knobEl.classList.toggle('active', state.recallPerPad);
				} else {
					updateKnobAngle(knobEl, value, cfg);
				}
			}
		}
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
            markerSequencer.stopLane(state.activePadIndex);
            updateSidebarStatus();
            // Stop motion playback if active
            if (motionCtrl && motionCtrl.isPlaying()) {
                motionCtrl.stop();
            }
            
			state.regions.set(state.activePadIndex, null as any);
			updatePadGrid();
			refreshMarkerUI();
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

const clearActivePadBtn = document.getElementById('clearActivePadBtn') as HTMLButtonElement | null;
if (clearActivePadBtn) {
	clearActivePadBtn.addEventListener('click', () => {
		if (state.activePadIndex != null) {
			deletePad(state.activePadIndex);
		}
	});
}

async function initMIDI(): Promise<boolean> {
	return ctx.midiApp!.init();
}
function highlightPending(target: string | null) {
	ctx.midiApp!.highlightPending(target);
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

// Zoom control handlers
const zoomValueEl = document.getElementById('zoomValue') as HTMLElement;

function updateZoomDisplay(val: number) {
	if (zoomValueEl) {
		zoomValueEl.textContent = `${val.toFixed(1)}x`;
	}
	if (waveform.setScale) {
		waveform.setScale(val);
	}
}

if (waveZoomInput) {
	waveZoomInput.addEventListener('input', () => {
		const val = parseFloat(waveZoomInput.value);
		updateZoomDisplay(val);
	});
	// Initialize zoom display
	updateZoomDisplay(parseFloat(waveZoomInput.value));
}

function updateSelPosUI() {
	const sel = waveform.getSelection();
	const knobEl = document.querySelector('.knob[data-knob="selpos"]') as HTMLElement | null;
	const valEl = document.querySelector('.tile-value[data-val="selpos"]') as HTMLElement | null;
	const buf = activeAudioBuffer();
	if (!sel || !buf) {
		if (valEl) valEl.textContent = '0';
		if (knobEl) {
			const cfg = ctx.tiles?.findConfig('selpos')!;
			updateKnobAngle(knobEl, 0, cfg);
		}
		return;
	}
	const width = sel.end - sel.start;
	const movable = Math.max(0, buf.duration - width);
	const pos = movable > 0 ? (sel.start / movable) : 0;
	const percent = Math.round(pos * 100);
	if (valEl) valEl.textContent = String(percent);
	if (knobEl) {
		const cfg = ctx.tiles?.findConfig('selpos')!;
		updateKnobAngle(knobEl, pos, cfg);
	}
}

async function loadAudioFromFile(file: File, assignPadIndex?: number) {
	const fileNameEl = document.getElementById('fileName');
	const fileLabel = document.querySelector('label[for="fileInput"]') as HTMLElement | null;
	const loadingSpinner = fileLabel?.querySelector('.file-loading-spinner') as HTMLElement | null;
	const knobPlus = fileLabel?.querySelector('.knob-plus') as HTMLElement | null;
	const setLoadingState = (loading: boolean) => {
		if (loadingSpinner) loadingSpinner.style.display = loading ? 'block' : 'none';
		if (knobPlus) knobPlus.style.display = loading ? 'none' : 'block';
		if (fileLabel) {
			fileLabel.style.pointerEvents = loading ? 'none' : 'auto';
			fileLabel.style.opacity = loading ? '0.7' : '1';
		}
	};
	const resetStatus = (msg?: string) => {
		if (fileNameEl && assignPadIndex == null) {
			const displayText = msg ? (msg.length > 20 ? msg.substring(0, 17) + '...' : msg) : '';
			fileNameEl.textContent = displayText;
		}
		const valEl = fileLabel?.closest('.param-tile')?.querySelector('.tile-value:not([data-val])') as HTMLElement | null;
		if (valEl) valEl.textContent = file ? '1' : '0';
	};

	try {
		setLoadingState(true);
		resetStatus('Loading...');
		await ensureAudioReady();
		const loaded = await loadAudioFile(state.contextMgr.audioContext, file);
		const filePath = (file as File & { path?: string }).path || null;

		if (assignPadIndex != null) {
			ctx.session!.padAudioBuffers.set(assignPadIndex, loaded.audioBuffer);
			ctx.session!.padAudioNames.set(assignPadIndex, loaded.name);
			if (filePath) ctx.session!.padAudioPaths.set(assignPadIndex, filePath);
			state.padParams.set(assignPadIndex, { audioSource: { kind: 'file', name: loaded.name } });
			if (!state.regions.get(assignPadIndex)) {
				state.regions.set(assignPadIndex, { start: 0, end: loaded.audioBuffer.duration, name: loaded.name });
			}
			await ensureEngine();
			await state.voiceManager?.setBufferForPad(assignPadIndex, loaded.audioBuffer);
			if (state.activePadIndex === assignPadIndex) {
				ctx.session!.lastShownWaveformBuffer = null;
				waveform.setBuffer(loaded.audioBuffer);
				ctx.session!.lastShownWaveformBuffer = loaded.audioBuffer;
				bufferDurEl.textContent = `Duration: ${loaded.audioBuffer.duration.toFixed(2)}s`;
				syncFileNameDisplay();
			}
			updatePadGrid();
			markSessionDirty();
			return;
		}

		resetStatus(loaded.name);
		state.buffer = loaded.audioBuffer;
		state.audioName = loaded.name;
		state.audioPath = filePath;
		if (fileLabel) fileLabel.classList.add('file-loaded');
		await ensureEngine();
		ensureEffects();
		if (state.activePadIndex === null && state.regions.getAll().length > 0) {
			state.activePadIndex = 0;
			if (!state.regions.get(0)) {
				state.regions.set(0, { start: 0, end: loaded.audioBuffer.duration, name: 'Full' });
			}
			recallPadParams(0, 0);
		}
		updatePadGrid();
		waveform.setBuffer(loaded.audioBuffer);
		ctx.session!.lastShownWaveformBuffer = loaded.audioBuffer;
		bufferDurEl.textContent = `Duration: ${loaded.audioBuffer.duration.toFixed(2)}s`;
		updateSelPosUI();
		refreshMarkerUI();
		if (state.voiceManager) {
			await state.voiceManager.setBuffer(loaded.audioBuffer);
		}
		markSessionDirty();
	} catch (error) {
		logger.error('Error loading audio file:', error);
		resetStatus('Error loading file');
		alert(error instanceof Error ? error.message : 'Error loading audio file. See console for details.');
		if (fileLabel && assignPadIndex == null) fileLabel.classList.remove('file-loaded');
	} finally {
		setLoadingState(false);
	}
}

fileInput.addEventListener('change', async (e) => {
	const file = (e.target as HTMLInputElement).files?.[0];
	if (!file) return;
	await loadAudioFromFile(file);
	(e.target as HTMLInputElement).value = '';
});

function ensureAudioReady() {
	return state.contextMgr.unlock();
}

// Global user gesture listener to automatically unlock AudioContext on first touch / click / keypress
const unlockAudioContextOnGesture = () => {
	ensureAudioReady();
	window.removeEventListener('pointerdown', unlockAudioContextOnGesture);
	window.removeEventListener('keydown', unlockAudioContextOnGesture);
};
window.addEventListener('pointerdown', unlockAudioContextOnGesture);
window.addEventListener('keydown', unlockAudioContextOnGesture);

async function ensureEngine() {
	if (!state.voiceManager) {
		try {
			state.voiceManager = new VoiceManager(state.contextMgr.audioContext, 4);
		ensureEffects();
		// Exit empty state now that a buffer is available
		setEmptyState(false);
			await state.voiceManager.init(state.effects!.input, (index) => state.padParams.get(index));
			
			if (state.buffer) {
				await state.voiceManager.setBuffer(state.buffer);
			}
		} catch (err) {
			logger.error('VoiceManager error:', err);
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
        // Update ctx.xyBaseFx snapshot if active
        if (ctx.xyBaseFx) {
            ctx.xyBaseFx = { ...ctx.xyBaseFx, ...patch };
        }
        // Update active voice engine & baseParams
        state.voiceManager?.updateVoiceBaseParams(state.activePadIndex, undefined, patch);
	}
	fxVisualizer?.setParams(merged);
	return merged;
}

function pushUndo() { ctx.session!.pushUndo(); }
function markSessionDirty() { ctx.session!.markDirty(); }
function clearSessionDirty() { ctx.session!.clearDirty(); }
function bufferForPad(index: number) { return ctx.session!.bufferForPad(index); }
function activeAudioBuffer() { return ctx.session!.activeAudioBuffer(); }
function showBufferForPad(index: number) { ctx.session!.showBufferForPad(index); }
function shiftPadAudioAfterDelete(deletedIndex: number) { ctx.session!.shiftPadAudioAfterDelete(deletedIndex); }
function remountPadAudioBuffers() { return ctx.session!.remountPadAudioBuffers(); }
function activePadBpm(index = state.activePadIndex ?? 0) { return ctx.session!.activePadBpm(index); }
function snapDelayBeats(seconds: number, bpm: number) { return ctx.session!.snapDelayBeats(seconds, bpm); }
function delayFromBeats(beats: number, bpm: number) { return ctx.session!.delayFromBeats(beats, bpm); }
function formatDelayBeats(beats: number) { return ctx.session!.formatDelayBeats(beats); }
function applyDelaySyncForPad(index: number) { ctx.session!.applyDelaySyncForPad(index); }
function applyDelaySyncForAllPads() { ctx.session!.applyDelaySyncForAllPads(); }
function syncDelayLabel() { ctx.session!.syncDelayLabel(); }
function syncFileNameDisplay() { ctx.session!.syncFileNameDisplay(); }
function applyScaleIndex(index: number) {
	state.activeScaleIndex = Math.max(0, Math.min(SCALES.length - 1, index));
	state.voiceManager?.setActiveScale(state.activeScaleIndex);
	const nameEl = document.getElementById('scaleNameDisplay');
	if (!nameEl) return;
	const scale = SCALES[state.activeScaleIndex];
	nameEl.textContent = scale.abbr;
	nameEl.classList.toggle('scale-off', state.activeScaleIndex === 0);
}
async function maybeRestoreAutosave() { await ctx.session!.maybeRestoreAutosave(); }
function captureProject() { return ctx.session!.captureProject(); }
function restoreProject(snap: any) { ctx.session!.restoreProject(snap); }

function syncPadVisualizer() {
	if (!padVisualizer) return;
	const regions = state.regions.getAll();
	const slots = [];
	for (let i = 0; i < MAX_PADS; i++) {
		const region = regions[i] ?? null;
		const visualIndex = region?.iconIndex !== undefined ? region.iconIndex : i;
		slots.push({
			assigned: !!region,
			playing: state.voiceManager?.isPadPlaying(i) ?? false,
			color: PAD_COLORS[visualIndex % PAD_COLORS.length],
		});
	}
	const idx = state.activePadIndex;
	padVisualizer.setState({
		slots,
		activeIndex: idx,
		buffer: idx != null ? bufferForPad(idx) : state.buffer,
		region: idx != null ? state.regions.get(idx) : null,
	});
}

function updatePadGrid() {
	padGridEl.innerHTML = '';
	const padGrid = createPadGrid(padGridEl, state.regions.getAll(), { colors: PAD_COLORS, activeIndex: state.activePadIndex, maxPads: MAX_PADS });
	padGrid.onAdd = () => {
		if (state.regions.getAll().length >= MAX_PADS) return;
		pushUndo();
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
		// Reset keyboard flag when switching pads
		if (prevIndex !== index) {
			xyUserUsingKeyboard = false;
			arrowKeysPressed.clear();
		}
		state.activePadIndex = index;
		showBufferForPad(index);

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
			refreshMarkerUI();
			
			// Ensure engine is running IF it's not already playing
			if (state.voiceManager && bufferForPad(index)) {
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
			refreshMarkerUI();
			recallWaveformSelection(index);
			updateSelPosUI();
			
			if (region && bufferForPad(index)) {
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
		updatePadGrid();
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
		showBufferForPad(index);
        
        // IMPORTANT: Snapshot base parameters from the new pad immediately
		snapshotBaseFromCurrentPad();
		
		// colorize waveform for this pad
		const region = state.regions.get(index);
		const effectiveIndex = region?.iconIndex !== undefined ? region.iconIndex : index;
		const c = PAD_COLORS[effectiveIndex % PAD_COLORS.length];
		waveform.setColor(c, hexToRgba(c, 0.18));
        if (motionCtrl) motionCtrl.setColor(c);
		refreshMarkerUI();
		
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
		if (!bufferForPad(index)) return;
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
	updateSidebarStatus();
	syncPadVisualizer();
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
    await ensureAudioReady();
    const playBuffer = bufferForPad(index);
    if (!playBuffer || !state.voiceManager) return;
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

    await state.voiceManager.trigger(
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
    syncMarkerEngine(index);
    updateSidebarStatus();
}

function getMarkerSeq(index: number): MarkerSeqParams {
	return state.padParams.get(index)?.markerSeq ?? defaultMarkerSeq();
}

function updateSidebarStatus() {
	const idx = state.activePadIndex;
	const playing = idx != null && (state.voiceManager?.isPadPlaying(idx) ?? false);
	if (sidebarStatusPadEl) {
		sidebarStatusPadEl.textContent = idx == null ? 'PAD —' : `PAD ${idx + 1}`;
		sidebarStatusPadEl.classList.toggle('is-live', playing);
	}
	const seq = idx != null ? getMarkerSeq(idx) : null;
	const running = idx != null && markerSequencer.isLaneRunning(idx);
	if (sidebarStatusSeqEl) {
		sidebarStatusSeqEl.textContent = running ? 'SEQ RUN' : (seq?.enabled ? 'SEQ ARM' : 'SEQ OFF');
		sidebarStatusSeqEl.classList.toggle('is-live', !!running);
	}
	sidebarNav.setLive('pads', playing);
	sidebarNav.setLive('seq', running);
	sidebarNav.setLive('io', state.recorder?.isRecording() ?? false);
	syncPadVisualizer();
}

function updateRandTooltip(enabled: boolean) {
	const el = document.querySelector('.knob[data-knob="rand"]') as HTMLElement | null;
	if (!el) return;
	el.setAttribute(
		'data-tooltip',
		enabled
			? 'Deviation around the current marker (0-200ms)'
			: 'Random start offset in milliseconds (0-200ms)'
	);
}

function refreshMarkerUI() {
	const index = state.activePadIndex ?? 0;
	const seq = getMarkerSeq(index);
	const region = state.regions.get(index);
	waveform.setMarkers(seq.markers);
	waveform.setRegionRange(region);
	markerRack?.sync(seq);
	const selectedId = waveform.getSelectedMarkerId();
	markerRack?.setHoldEnabled(!!selectedId);
	updateRandTooltip(seq.enabled);
	(['marker-bpm', 'marker-chance', 'marker-bloom-change', 'marker-euclid-hits', 'marker-euclid-steps', 'marker-hold', 'marker-drift', 'marker-drift-speed'] as const).forEach((id) => {
		const cfg = ctx.tiles?.findConfig(id);
		if (!cfg) return;
		const knobEl = document.querySelector(`.knob[data-knob="${id}"]`) as HTMLElement | null;
		const valEl = document.querySelector(`.tile-value[data-val="${id}"]`) as HTMLElement | null;
		if (!knobEl || !valEl) return;
		const v = cfg.get();
		valEl.textContent = cfg.format(v);
		updateKnobAngle(knobEl, v, cfg);
	});
}

function syncMarkerEngine(index: number, liveRegion?: { start: number; end: number } | null) {
	const params = state.padParams.get(index);
	if (!params) {
		markerSequencer.stopLane(index);
		updateSidebarStatus();
		return;
	}
	const seq = params.markerSeq ?? defaultMarkerSeq();
	const storedRegion = state.regions.get(index);
	const region = liveRegion ?? storedRegion;
	const markers = (liveRegion && storedRegion && bufferForPad(index))
		? shiftMarkersWithRegion(seq.markers, storedRegion, liveRegion, bufferForPad(index)!.duration)
		: seq.markers;
	markerSequencer.syncLane(index, {
		enabled: seq.enabled,
		playing: state.voiceManager?.isPadPlaying(index) ?? false,
		params: { ...seq, markers },
		region,
		density: params.granular.density,
		duration: bufferForPad(index)?.duration ?? 0
	});
	if (markerSequencer.isLaneRunning(index) && state.voiceManager) {
		if (isDiscreteGrainMode(seq.grainMode)) {
			state.voiceManager.setVoiceAutoSpawn(index, false);
		} else {
			state.voiceManager.setVoiceAutoSpawn(index, true);
		}
	}
	updateSidebarStatus();
}

let markerRack = createMarkerRack({
	onChange: (patch) => {
		if (state.activePadIndex == null) return;
		state.padParams.setMarkerSeq(state.activePadIndex, patch);
		refreshMarkerUI();
		syncMarkerEngine(state.activePadIndex);
	},
	onPlayToggle: () => {
		if (state.activePadIndex == null) return;
		const seq = getMarkerSeq(state.activePadIndex);
		state.padParams.setMarkerSeq(state.activePadIndex, { enabled: !seq.enabled });
		refreshMarkerUI();
		syncMarkerEngine(state.activePadIndex);
	},
	onClear: () => {
		if (state.activePadIndex == null) return;
		pushUndo();
		state.padParams.setMarkerSeq(state.activePadIndex, clearMarkers(getMarkerSeq(state.activePadIndex)));
		refreshMarkerUI();
		syncMarkerEngine(state.activePadIndex);
	}
});

waveform.onMarkersChange((markers) => {
	if (state.activePadIndex == null) return;
	state.padParams.setMarkerSeq(state.activePadIndex, { markers });
	syncMarkerEngine(state.activePadIndex);
});
waveform.onGestureStart(() => {
	pushUndo();
});

waveform.onMarkerSelect((id) => {
	if (state.activePadIndex == null) return;
	refreshMarkerUI();
	if (!id) return;
	if (markerSequencer.isLaneRunning(state.activePadIndex)) {
		markerSequencer.jumpToMarker(state.activePadIndex, id);
	}
});

window.addEventListener('keydown', (e) => {
	if (e.key !== 'Backspace' && e.key !== 'Delete') return;
	const target = e.target as HTMLElement | null;
	if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) {
		return;
	}
	if (waveform.getSelectedMarkerId()) {
		pushUndo();
		waveform.removeSelectedMarker();
		e.preventDefault();
	}
});

window.addEventListener('keydown', (e) => {
	const target = e.target as HTMLElement | null;
	if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) {
		return;
	}
	if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
	e.preventDefault();
	if (e.shiftKey) {
		ctx.session!.redo();
	} else {
		ctx.session!.undo();
	}
});

// ---------- VISUALIZATION LOOP ----------
// Sync UI with Audio Engine state (Active Pad only)
// Throttled to reduce CPU load when multiple pads are active
function startVisualizationLoop() {
    let lastUpdate = 0;
    const UI_UPDATE_INTERVAL = 16; // ~60fps for UI (smooth visuals)
    
    const loop = () => {
        const now = performance.now();
        const shouldUpdate = (now - lastUpdate) >= UI_UPDATE_INTERVAL;
        
        if (shouldUpdate && state.voiceManager) {
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
                    // Throttle visual updates to reduce DOM manipulation overhead
                    if (!xyUserDragging) {
                         updateVisualsFromXY(pos.x, pos.y);
                    }
                }
            }

            const seqView = document.getElementById('sidebar-view-seq');
            const seqVisible = !!seqView && !seqView.hidden;
            const visual = state.activePadIndex != null
                ? markerSequencer.getLaneVisual(state.activePadIndex)
                : null;
            if (seqVisible) {
                markerRack?.updateLive(visual);
            }
            if (state.activePadIndex != null) {
                const live = visual
                    ? new Map(visual.markers.filter(m => m.driftMs > 0).map(m => [m.id, m.liveSec]))
                    : null;
                waveform.setPlaybackVisual(visual?.playheadSec ?? null, live && live.size > 0 ? live : null);
            } else {
                waveform.setPlaybackVisual(null, null);
            }
            
            lastUpdate = now;
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
    if (ctx.xyBaseGranular == null || ctx.xyBaseFx == null) {
        snapshotBaseFromCurrentPad();
    }
    if (!ctx.xyBaseGranular || !ctx.xyBaseFx) return;

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
        granular: ctx.xyBaseGranular,
        effects: ctx.xyBaseFx,
        selectionPos: xyBaseSelectionPos ?? 0
    };

    const { granular: granularUpdate, effects: fxUpdate, selectionPos: selectionPosUpdate } = ParameterMapper.mapParams(
        weights,
        baseParams,
        cornerMapping
    );
    
    // 3. Apply selectionPos to buffer if calculated
    if (selectionPosUpdate !== undefined && state.buffer && state.activePadIndex != null) {
        const region = state.regions.get(state.activePadIndex);
        if (region) {
            const width = region.end - region.start;
            const movable = Math.max(0, state.buffer.duration - width);
            if (movable > 0) {
                const newStart = selectionPosUpdate * movable;
                const newEnd = newStart + width;
                // Clamp to buffer bounds
                const clampedStart = Math.max(0, Math.min(newStart, state.buffer.duration - width));
                const clampedEnd = Math.min(state.buffer.duration, clampedStart + width);
                
                // Update Waveform Visual UI silently without polluting pad region store during temporary morph
                isXYMorphing = true;
                waveform.setSelection(clampedStart, clampedEnd);
                updateSelPosUI();
                const seq = getMarkerSeq(state.activePadIndex);
                const storedRegion = state.regions.get(state.activePadIndex);
                if (storedRegion && state.buffer) {
                    const live = { start: clampedStart, end: clampedEnd };
                    waveform.setMarkers(shiftMarkersWithRegion(seq.markers, storedRegion, live, state.buffer.duration));
                    waveform.setRegionRange(live);
                    syncMarkerEngine(state.activePadIndex, live);
                    markersLiveShifted = true;
                }
                isXYMorphing = false;
            }
        }
    } else if (markersLiveShifted && state.activePadIndex != null) {
        const storedRegion = state.regions.get(state.activePadIndex);
        waveform.setMarkers(getMarkerSeq(state.activePadIndex).markers);
        waveform.setRegionRange(storedRegion);
        syncMarkerEngine(state.activePadIndex);
        markersLiveShifted = false;
    }
    
    // Quantize pitch for UI display if scale is active
    if (granularUpdate.pitchSemitones !== undefined && state.activeScaleIndex !== 0) {
        granularUpdate.pitchSemitones = quantizePitch(granularUpdate.pitchSemitones, state.activeScaleIndex);
    }
    
    // 4. Update Knobs UI
    controls.setGranularUI(granularUpdate);
    controls.setFxUI(fxUpdate);
    refreshParamTilesFromValues(granularUpdate, fxUpdate, selectionPosUpdate); // Updates the knobs rotation with interpolated values
    
    // 5. Update XY Pad Visuals (Density, Color, Reverb)
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
    fxVisualizer?.setParams({ ...getActiveFxParams(), ...fxUpdate });
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
ctx.controls = controls;

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
			if (safeRegion.end > 0) {
				skipNextMarkerShift = true;
				waveform.setSelection(safeRegion.start, safeRegion.end);
			}
			updateSelPosUI();
			
			controls.setGranularUI(target.granular);
			controls.setFxUI(target.effects);
			refreshParamTilesFromState();
			
			// Restore XY position for this pad
			if (xy.setPositionSilent) {
				xy.setPositionSilent(target.xy.x, target.xy.y);
			}
			refreshMarkerUI();
			
			// Update visual cues immediately
			xy.setReverbMix?.(target.effects.reverbMix);
			
			const cutoffWeight = calculateParamWeight('filterCutoffHz', targetXY);
			xy.setFilterCutoff?.(target.effects.filterCutoffHz, cutoffWeight);
			
			const densityWeight = calculateParamWeight('density', targetXY);
			xy.setDensity?.(target.granular.density, densityWeight);
			fxVisualizer?.setParams(target.effects);
			syncDelayLabel();
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
			skipNextMarkerShift = true;
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
				filterQ: (fromFx.filterQ ?? 0.707) + ((toFx.filterQ ?? 0.707) - (fromFx.filterQ ?? 0.707)) * t,
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
			fxVisualizer?.setParams(interpFx);
			if (step >= steps) {
				clearInterval(recallTimer!);
				recallTimer = null;
				refreshMarkerUI();
				syncDelayLabel();
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
	if (r && bufferForPad(index)) {
		skipNextMarkerShift = true;
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
		const options: SelectOption[] = [
			{ value: 'none', label: 'None' }
		];
		for (let i = 0; i < padCount; i++) {
			const r = state.regions.get(i);
			const name = r?.name ? ` – ${r.name}` : '';
			options.push({
				value: `pad:${i}`,
				label: `Pad ${i + 1}${name}`
			});
		}
		return options;
	} else {
		return [
			{ value: 'none', label: 'None' },
			...PARAMS.map(p => ({
				value: p.id,
				label: p.label
			}))
		];
	}
}

function populateParamSelect(select: ReturnType<typeof createCustomSelect> | null) {
	if (!select) return;
	const currentValue = select.getValue();
	const options = getParamOptions();
	select.setOptions(options);
	
	// Restore previous value if it exists, otherwise fallback to 'none' or first option
	if (currentValue && options.some(opt => opt.value === currentValue)) {
		select.setValue(currentValue);
	} else if (options.some(opt => opt.value === 'none')) {
		select.setValue('none');
	} else if (options.length > 0) {
		select.setValue(options[0].value);
	}
}

function syncActiveVoiceCornerMapping() {
	if (state.activePadIndex == null || !state.voiceManager) return;
	const voice = state.voiceManager.getActiveVoiceForPad(state.activePadIndex);
	if (!voice) return;
	voice.cornerMapping = {
		tl: customSelectTL?.getValue() || '',
		tr: customSelectTR?.getValue() || '',
		bl: customSelectBL?.getValue() || '',
		br: customSelectBR?.getValue() || ''
	};
	state.voiceManager.refreshVoiceParams(state.activePadIndex);
}

// Initialize custom selects
customSelectTL = createCustomSelect({
	element: cornerTL,
	options: getParamOptions(),
	value: 'filterCutoffHz',
	onChange: (value) => {
		refreshXYCornerLabels();
		// Update base snapshot when corner mapping changes to ensure interpolation works correctly
		snapshotBaseFromCurrentPad();
		syncActiveVoiceCornerMapping();
	}
});

customSelectTR = createCustomSelect({
	element: cornerTR,
	options: getParamOptions(),
	value: 'density',
	onChange: (value) => {
		refreshXYCornerLabels();
		// Update base snapshot when corner mapping changes to ensure interpolation works correctly
		snapshotBaseFromCurrentPad();
		syncActiveVoiceCornerMapping();
	}
});

customSelectBL = createCustomSelect({
	element: cornerBL,
	options: getParamOptions(),
	value: 'reverbMix',
	onChange: (value) => {
		refreshXYCornerLabels();
		// Update base snapshot when corner mapping changes to ensure interpolation works correctly
		snapshotBaseFromCurrentPad();
		syncActiveVoiceCornerMapping();
	}
});

customSelectBR = createCustomSelect({
	element: cornerBR,
	options: getParamOptions(),
	value: 'pitchSemitones',
	onChange: (value) => {
		refreshXYCornerLabels();
		// Update base snapshot when corner mapping changes to ensure interpolation works correctly
		snapshotBaseFromCurrentPad();
		syncActiveVoiceCornerMapping();
	}
});
ctx.customSelectTL = customSelectTL;
ctx.customSelectTR = customSelectTR;
ctx.customSelectBL = customSelectBL;
ctx.customSelectBR = customSelectBR;

// Connect 3D vertex click events from Three.js scene to open custom selects
if (xy?.onCornerClick) {
	xy.onCornerClick((cornerKey) => {
		switch (cornerKey) {
			case 'tl':
				customSelectTL?.open();
				break;
			case 'tr':
				customSelectTR?.open();
				break;
			case 'bl':
				customSelectBL?.open();
				break;
			case 'br':
				customSelectBR?.open();
				break;
		}
	});
}

let xyBaseSelectionPos: number | null = null; // 0..1 normalized along movable range
// Track manual drag on XY pad to allow overriding motion automation safely
let xyUserDragging = false;
let xyUserUsingKeyboard = false;
let xyUserUsingGamepad = false;
if (xyCanvas) {
	xyCanvas.addEventListener('pointerdown', () => { xyUserDragging = true; });
	const stopDrag = () => { xyUserDragging = false; };
	xyCanvas.addEventListener('pointerup', stopDrag);
	xyCanvas.addEventListener('pointerleave', stopDrag);
	xyCanvas.addEventListener('pointercancel', stopDrag);
}

// Track keyboard arrow key usage for XY pad movement
const arrowKeysPressed = new Set<string>();
window.addEventListener('keydown', (ev) => {
	if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight' || ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
		arrowKeysPressed.add(ev.key);
		// Only activate if XY pad is visible and we have an active pad
		if (xyCanvas && state.activePadIndex != null) {
			xyUserUsingKeyboard = true;
		}
	}
});

window.addEventListener('keyup', (ev) => {
	if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight' || ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
		arrowKeysPressed.delete(ev.key);
		// Reset flag only when all arrow keys are released
		if (arrowKeysPressed.size === 0) {
			// Small delay to allow last onChange event to fire
			setTimeout(() => {
				xyUserUsingKeyboard = false;
				if (state.activePadIndex != null && !xyUserUsingGamepad) {
					state.voiceManager?.setVoiceManualOverride(state.activePadIndex, false);
				}
			}, 50);
		}
	}
});

function refreshXYCornerLabels() {
	const mode = getXYMode();
	if (mode === 'pads') {
		const label = (v: string) => {
			if (!v || v === 'none') return 'None';
			const parts = v.split(':');
			if (parts[0] !== 'pad') return 'None';
			const idx = Number(parts[1]);
			if (isNaN(idx)) return 'None';
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
		const label = (id: string) => {
			if (!id || id === 'none') return 'None';
			return PARAMS.find(p => p.id === (id as ParamId))?.label ?? 'None';
		};
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
		if (tl && tl !== ('none' as any)) currentParams.add(tl);
		if (tr && tr !== ('none' as any)) currentParams.add(tr);
		if (bl && bl !== ('none' as any)) currentParams.add(bl);
		if (br && br !== ('none' as any)) currentParams.add(br);
		
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
	if (mode === 'pads') {
		// Default all pad morphing corners to 'none' as requested
		customSelectTL?.setValue('none');
		customSelectTR?.setValue('none');
		customSelectBL?.setValue('none');
		customSelectBR?.setValue('none');
	} else {
		// Set values before populating to ensure they're valid
		customSelectTL?.setValue('filterCutoffHz');
		customSelectTR?.setValue('density');
		customSelectBL?.setValue('reverbMix');
		customSelectBR?.setValue('pitchSemitones');
	}
	populateParamSelect(customSelectTL);
	populateParamSelect(customSelectTR);
	populateParamSelect(customSelectBL);
	populateParamSelect(customSelectBR);
	refreshXYCornerLabels();
}
xyModeParamsBtn?.addEventListener('click', () => handleXYModeChange('params'));
xyModePadsBtn?.addEventListener('click', () => handleXYModeChange('pads'));
// Initialize default mode (params)
setXYMode('params');

function updateKnobAngle(knobEl: HTMLElement, value: number, cfg: { min: number; max: number; get?: () => number; set?: (v: number) => void; format?: (v: number) => string; id?: string; step?: number }) {
	ctx.tiles?.updateKnobAngle(knobEl, value, cfg as any);
}
function updateValueDisplay(cfg: { id: string; min: number; max: number; step: number; get: () => number; set: (v: number) => void; format: (v: number) => string }, value: number) {
	ctx.tiles?.updateValueDisplay(cfg, value);
}
function refreshParamTilesFromState() {
	ctx.tiles?.refreshFromState();
}
function refreshParamTilesFromValues(granular?: Partial<GranularParams>, effects?: Partial<EffectsParams>, selectionPosUpdate?: number) {
	ctx.tiles?.refreshFromValues(granular, effects, selectionPosUpdate);
}

// Empty state handling
const emptyStateOverlay = document.getElementById('emptyStateOverlay');

function setEmptyState(isEmpty: boolean) {
	if (isEmpty) {
		document.body.classList.add('empty-state');
		if (emptyStateOverlay) emptyStateOverlay.style.display = 'flex';
	} else {
		document.body.classList.remove('empty-state');
		if (emptyStateOverlay) emptyStateOverlay.style.display = 'none';
	}
}

ctx.session = createSessionController(ctx);
ctx.session.bindUi();
ctx.pads = createPadActions(ctx, {
	setSkipNextMarkerShift: (value) => { skipNextMarkerShift = value; }
});
ctx.midiApp = createMidiApp(ctx, {
	resetXyKeyboard: () => {
		xyUserUsingKeyboard = false;
		arrowKeysPressed.clear();
	}
});
ctx.pads.bindUi();
bindAppHost(ctx, {
	triggerPad,
	recallPadParams,
	refreshMarkerUI,
	applyFxToEngine,
	syncMarkerEngine,
	updatePadGrid,
	updateSidebarStatus,
	updateSelPosUI,
	updateVisualsFromXY,
	ensureAudioReady,
	ensureEngine,
	ensureEffects,
	loadAudioFromFile,
	setEmptyState,
	getXYMode,
	setXYMode,
	populateParamSelects: () => {
		populateParamSelect(customSelectTL);
		populateParamSelect(customSelectTR);
		populateParamSelect(customSelectBL);
		populateParamSelect(customSelectBR);
	},
	refreshXYCornerLabels,
	syncXYToPad,
	snapshotBaseFromCurrentPad,
	getMarkerSeq,
	applyScaleIndex,
	updateZoomDisplay,
	getActiveFxParams,
	recallWaveformSelection,
	syncPadVisualizer,
	activeAudioBuffer,
	activePadBpm,
	snapDelayBeats,
	delayFromBeats,
	formatDelayBeats,
	applyDelaySyncForPad,
	initMIDI,
	highlightPending,
	markSessionDirty
});
ctx.tiles = createParamTiles(ctx);
ctx.tiles.init();
initAppBoot(ctx);

// Initialize value display box with default
const box = document.getElementById('valueDisplayBox');
const labelEl = box?.querySelector('.value-display-label') as HTMLElement | null;
const valueEl = box?.querySelector('.value-display-value') as HTMLElement | null;
if (labelEl && valueEl) {
	labelEl.textContent = '—';
	valueEl.textContent = '—';
}

// Initialize XY Pad speeds from active pad (if any) or use defaults
if (state.activePadIndex != null) {
	const pad = state.padParams.get(state.activePadIndex);
	const normalSpeed = pad?.xySpeed ?? 0.15;
	const shiftSpeed = pad?.xyShift ?? 0.05;
	xy.setSpeed?.(normalSpeed, shiftSpeed);
	xy.setReverbMix?.(pad.effects.reverbMix);
	xy.setFilterCutoff?.(pad.effects.filterCutoffHz, 0);
	xy.setDensity?.(pad.granular.density, 0);
} else {
	// Use defaults if no pad is active
	xy.setSpeed?.(0.15, 0.05);
}
	function snapshotBaseFromCurrentPad() {
		// snapshot current pad parameters as base
		if (state.activePadIndex == null) return;
		const pad = state.padParams.get(state.activePadIndex);
        
        // Deep copy to prevent reference issues if pad params are mutated elsewhere
		ctx.xyBaseGranular = JSON.parse(JSON.stringify(pad.granular));
		ctx.xyBaseFx = JSON.parse(JSON.stringify(pad.effects));
		
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
            // This ensures audio reacts immediately to dragging or keyboard movement
            // CRITICAL FIX: Only trigger override if USER is actually dragging, using keyboard, or gamepad.
            // Programmatic updates (like syncXYToPad) should NOT lock the voice.
            if (xyUserDragging || xyUserUsingKeyboard || xyUserUsingGamepad) {
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

    // Reset override when drag ends or keyboard stops
    if (xyCanvas) {
        const resetOverride = () => {
            if (state.activePadIndex != null) {
                if (!xyUserUsingKeyboard && !xyUserUsingGamepad) {
                    state.voiceManager?.setVoiceManualOverride(state.activePadIndex, false);
                }
            }
            xyUserDragging = false;
        };
        xyCanvas.addEventListener('pointerup', resetOverride);
        xyCanvas.addEventListener('pointerleave', resetOverride);
        xyCanvas.addEventListener('pointercancel', resetOverride);
    }

    createGamepadManager({
        isEnabled: () => state.activePadIndex != null,
        getSpeed: () => {
            if (state.activePadIndex == null) return { normal: 0.15, shift: 0.05 };
            const pad = state.padParams.get(state.activePadIndex);
            return {
                normal: pad?.xySpeed ?? 0.15,
                shift: pad?.xyShift ?? 0.05,
            };
        },
        getPosition: () => xy.getPosition(),
        onMove: (pos) => xy.setPosition(pos.x, pos.y),
        onActiveChange: (active) => {
            xyUserUsingGamepad = active;
            if (!active && state.activePadIndex != null && !xyUserUsingKeyboard && !xyUserDragging) {
                state.voiceManager?.setVoiceManualOverride(state.activePadIndex, false);
            }
        },
    });

    // Reset override when keyboard stops (handled in keyup listener above)
