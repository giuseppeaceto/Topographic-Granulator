import type { createAudioContextManager } from '../audio/AudioContextManager';
import type { createAudioRecorder } from '../audio/AudioRecorder';
import type { createMarkerSequencer } from '../audio/MarkerSequencer';
import type { VoiceManager } from '../audio/VoiceManager';
import type { MarkerSeqParams } from '../editor/MarkerStore';
import type { createPadParamStore } from '../editor/PadParamStore';
import type { createRegionStore } from '../editor/RegionStore';
import type { EffectsChain, EffectsParams } from '../effects/EffectsChain';
import type { GranularParams } from '../granular/GranularWorkletEngine';
import type { MidiManager, MidiMapping } from '../midi/MidiManager';
import type { MidiPlayMode } from '../session/SessionStore';
import type { createCustomSelect } from '../ui/CustomSelect';
import type { createFxVisualizer } from '../ui/FxVisualizer';
import type { createMotionPanel } from '../ui/MotionPanel';
import type { createPadVisualizer } from '../ui/PadVisualizer';
import type { initSidebarNav } from '../ui/SidebarNav';
import type { createThemeManager } from '../ui/ThemeManager';
import type { createWaveformView } from '../ui/WaveformView';
import type { XYPad } from '../ui/XYPad';

export const MAX_PADS = 3;
export const PAD_COLORS = ['#A1E34B', '#66D9EF', '#FDBC40', '#FF7AA2', '#7C4DFF', '#00E5A8', '#F06292', '#FFD54F'];
export const DELAY_SYNC_BEATS = [0.125, 0.25, 1 / 3, 0.5, 0.75, 1, 1.5, 2];

export type AppState = {
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
	activeScaleIndex: number;
	midiMode: MidiPlayMode;
	audioName: string | null;
	audioPath: string | null;
};

export type KnobConfig = {
	id: string;
	min: number;
	max: number;
	step: number;
	get: () => number;
	set: (v: number) => void;
	format: (v: number) => string;
	getMin?: () => number;
	getMax?: () => number;
	toNorm?: (value: number, min: number, max: number) => number;
	fromNorm?: (norm: number, min: number, max: number) => number;
};

export type ParamTiles = {
	configs: KnobConfig[];
	findConfig: (id: string) => KnobConfig | undefined;
	refreshFromState: () => void;
	refreshFromValues: (granular?: Partial<GranularParams>, effects?: Partial<EffectsParams>, selectionPosUpdate?: number) => void;
	refreshDurationKnobs: () => void;
	updateKnobAngle: (knobEl: HTMLElement, value: number, cfg: KnobConfig) => void;
	updateValueDisplay: (cfg: KnobConfig, value: number) => void;
	init: () => void;
	initButtonKnobs: () => void;
};

export type SessionController = {
	pushUndo: () => void;
	markDirty: () => void;
	clearDirty: () => void;
	captureProject: () => unknown;
	restoreProject: (snap: unknown) => void;
	undo: () => void;
	redo: () => void;
	bufferForPad: (index: number) => AudioBuffer | null;
	activeAudioBuffer: () => AudioBuffer | null;
	showBufferForPad: (index: number) => void;
	shiftPadAudioAfterDelete: (deletedIndex: number) => void;
	remountPadAudioBuffers: () => Promise<void>;
	padAudioBuffers: Map<number, AudioBuffer>;
	padAudioNames: Map<number, string>;
	padAudioPaths: Map<number, string>;
	activePadBpm: (index?: number) => number;
	snapDelayBeats: (seconds: number, bpm: number) => number;
	delayFromBeats: (beats: number, bpm: number) => number;
	applyDelaySyncForPad: (index: number) => void;
	applyDelaySyncForAllPads: () => void;
	formatDelayBeats: (beats: number) => string;
	syncDelayLabel: () => void;
	syncFileNameDisplay: () => void;
	buildSessionDocument: () => import('../session/SessionStore').UndergrainSession;
	applySession: (
		session: import('../session/SessionStore').UndergrainSession,
		loaded: { shared: AudioBuffer | null; padBuffers: Map<number, AudioBuffer>; jsonPath?: string },
		opts?: { promptMissingAudio?: boolean }
	) => Promise<void>;
	save: () => Promise<void>;
	open: () => Promise<void>;
	maybeRestoreAutosave: () => Promise<void>;
	bindUi: () => void;
	lastShownWaveformBuffer: AudioBuffer | null;
};

export type PadActions = {
	openEditModal: (index: number, pendingRegion: { start: number; end: number } | null) => void;
	closeEditModal: () => void;
	deletePad: (index: number) => void;
	duplicatePad: (index: number) => void;
	randomizePad: (index: number) => void;
	bindUi: () => void;
	currentEditIndex: () => number | null;
};

export type MidiApp = {
	init: () => Promise<boolean>;
	applyToTarget: (targetId: string, norm: number) => void;
	highlightPending: (target: string | null) => void;
	handleKeyOn: (note: number, velocity: number) => void;
	handleKeyOff: (note: number) => void;
};

export type AppHost = {
	triggerPad: (index: number) => Promise<void>;
	recallPadParams: (index: number, durationMs?: number, fromIndex?: number | null) => void;
	refreshMarkerUI: () => void;
	applyFxToEngine: (patch: Partial<EffectsParams>) => EffectsParams;
	syncMarkerEngine: (index: number, liveRegion?: { start: number; end: number } | null) => void;
	updatePadGrid: () => void;
	updateSidebarStatus: () => void;
	updateSelPosUI: () => void;
	updateVisualsFromXY: (x: number, y: number) => void;
	ensureAudioReady: () => Promise<void> | void;
	ensureEngine: () => Promise<void>;
	ensureEffects: () => void;
	loadAudioFromFile: (file: File, assignPadIndex?: number) => Promise<void>;
	setEmptyState: (isEmpty: boolean) => void;
	getXYMode: () => 'params' | 'pads';
	setXYMode: (mode: 'params' | 'pads') => void;
	populateParamSelects: () => void;
	refreshXYCornerLabels: () => void;
	syncXYToPad: (index: number, triggerChange?: boolean) => void;
	snapshotBaseFromCurrentPad: () => void;
	getMarkerSeq: (index: number) => MarkerSeqParams;
	applyScaleIndex: (index: number) => void;
	updateZoomDisplay: (val: number) => void;
	getActiveFxParams: () => EffectsParams;
	recallWaveformSelection: (index: number) => void;
	syncPadVisualizer: () => void;
	activeAudioBuffer: () => AudioBuffer | null;
	activePadBpm: (index?: number) => number;
	snapDelayBeats: (seconds: number, bpm: number) => number;
	delayFromBeats: (beats: number, bpm: number) => number;
	formatDelayBeats: (beats: number) => string;
	applyDelaySyncForPad: (index: number) => void;
	initMIDI: () => Promise<boolean>;
	highlightPending: (target: string | null) => void;
	markSessionDirty: () => void;
	playMarkerSlice: (padIndex: number, sliceIndex: number, velocity?: number) => Promise<void>;
	releaseMarkerSlice: (padIndex: number, sliceIndex: number) => void;
};

export type AppContext = {
	state: AppState;
	waveform: ReturnType<typeof createWaveformView>;
	xy: XYPad;
	markerSequencer: ReturnType<typeof createMarkerSequencer>;
	sidebarNav: ReturnType<typeof initSidebarNav>;
	fxVisualizer: ReturnType<typeof createFxVisualizer> | null;
	padVisualizer: ReturnType<typeof createPadVisualizer> | null;
	themeManager: ReturnType<typeof createThemeManager>;
	themeToggleBtn: HTMLButtonElement | null;
	host: AppHost;
	motionCtrl: ReturnType<typeof createMotionPanel> | null;
	customSelectTL: ReturnType<typeof createCustomSelect> | null;
	customSelectTR: ReturnType<typeof createCustomSelect> | null;
	customSelectBL: ReturnType<typeof createCustomSelect> | null;
	customSelectBR: ReturnType<typeof createCustomSelect> | null;
	xyBaseGranular: GranularParams | null;
	xyBaseFx: EffectsParams | null;
	heldMidiNotes: number[];
	tiles: ParamTiles | null;
	session: SessionController | null;
	pads: PadActions | null;
	midiApp: MidiApp | null;
};

export function createAppContext(
	init: Pick<
		AppContext,
		| 'state'
		| 'waveform'
		| 'xy'
		| 'markerSequencer'
		| 'sidebarNav'
		| 'fxVisualizer'
		| 'padVisualizer'
		| 'themeManager'
		| 'themeToggleBtn'
	>
): AppContext {
	return {
		...init,
		host: {} as AppHost,
		motionCtrl: null,
		customSelectTL: null,
		customSelectTR: null,
		customSelectBL: null,
		customSelectBR: null,
		xyBaseGranular: null,
		xyBaseFx: null,
		heldMidiNotes: [],
		tiles: null,
		session: null,
		pads: null,
		midiApp: null
	};
}

export function bindAppHost(ctx: AppContext, host: AppHost) {
	ctx.host = host;
}
