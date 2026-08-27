import type { AppContext, SessionController } from '../app/AppContext';
import { MAX_PADS } from '../app/AppContext';
import type { Region } from '../editor/RegionStore';
import type { PadParams } from '../editor/PadParamStore';
import { clonePadParams, emptyPadParams, parseSession, joinDir, AUTOSAVE_KEY, type UndergrainSession } from './SessionStore';
import { createUndoStack } from './UndoStack';
import { loadSessionFromDisk, saveSessionToDisk } from './sessionIo';
import { saveMappings } from '../midi/MidiManager';
import { logger } from '../utils/logger';
import { DELAY_SYNC_BEATS } from '../app/AppContext';

type PadAudioSnap = { index: number; buffer: AudioBuffer; name: string; path: string | null };
type ProjectSnap = { regions: Array<Region | null>; pads: PadParams[]; activePadIndex: number | null; padAudio: PadAudioSnap[] };

export function createSessionController(ctx: AppContext): SessionController {
const padAudioBuffers = new Map<number, AudioBuffer>();
const padAudioNames = new Map<number, string>();
const padAudioPaths = new Map<number, string>();
const undoStack = createUndoStack<ProjectSnap>();
let sessionDirty = false;
let autosaveTimer: number | null = null;
let lastShownWaveformBuffer: AudioBuffer | null = null;

function captureProject(): ProjectSnap {
	const padAudio: PadAudioSnap[] = [];
	for (const [index, buffer] of padAudioBuffers) {
		padAudio.push({
			index,
			buffer,
			name: padAudioNames.get(index) ?? `pad-${index + 1}`,
			path: padAudioPaths.get(index) ?? null
		});
	}
	return {
		regions: ctx.state.regions.getAll().map((r) => (r ? { ...r } : null)),
		pads: ctx.state.padParams.cloneAll(),
		activePadIndex: ctx.state.activePadIndex,
		padAudio
	};
}

function markSessionDirty() {
	sessionDirty = true;
	document.title = 'Undergrain — *';
	if (autosaveTimer != null) window.clearTimeout(autosaveTimer);
	autosaveTimer = window.setTimeout(() => {
		try {
			const session = buildSessionDocument();
			localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(session));
		} catch {}
	}, 1500) as unknown as number;
}

function clearSessionDirty() {
	sessionDirty = false;
	document.title = 'Undergrain — Topographic Granulator';
}

function pushUndo() {
	undoStack.push(captureProject());
	markSessionDirty();
}

function restorePadAudioMaps(snaps: PadAudioSnap[]) {
	padAudioBuffers.clear();
	padAudioNames.clear();
	padAudioPaths.clear();
	for (const snap of snaps) {
		padAudioBuffers.set(snap.index, snap.buffer);
		padAudioNames.set(snap.index, snap.name);
		if (snap.path) padAudioPaths.set(snap.index, snap.path);
	}
	void remountPadAudioBuffers();
}

function restoreProject(snap: ProjectSnap) {
	ctx.state.regions.replaceAll(snap.regions);
	ctx.state.padParams.replaceAll(snap.pads);
	ctx.state.activePadIndex = snap.activePadIndex;
	restorePadAudioMaps(snap.padAudio);
	ctx.host.updatePadGrid();
	if (ctx.state.activePadIndex != null) {
		showBufferForPad(ctx.state.activePadIndex);
		ctx.host.recallPadParams(ctx.state.activePadIndex, 0);
		ctx.host.refreshMarkerUI();
		ctx.host.syncMarkerEngine(ctx.state.activePadIndex);
	} else {
		ctx.waveform.clearSelection();
	}
	applyDelaySyncForAllPads();
	syncDelayLabel();
	syncFileNameDisplay();
}

function activePadBpm(index = ctx.state.activePadIndex ?? 0): number {
	return Math.max(40, ctx.host.getMarkerSeq(index).bpm || 120);
}

function snapDelayBeats(seconds: number, bpm: number): number {
	const beats = seconds * bpm / 60;
	let best = DELAY_SYNC_BEATS[0];
	let bestD = Math.abs(beats - best);
	for (const b of DELAY_SYNC_BEATS) {
		const d = Math.abs(beats - b);
		if (d < bestD) {
			best = b;
			bestD = d;
		}
	}
	return best;
}

function delayFromBeats(beats: number, bpm: number): number {
	return Math.max(0, Math.min(1.2, beats * 60 / bpm));
}

function applyDelaySyncForPad(index: number) {
	const fx = ctx.state.padParams.get(index)?.effects;
	if (!fx?.delaySync) return;
	const bpm = activePadBpm(index);
	const beats = snapDelayBeats(fx.delayTimeSec || 0.25, bpm);
	const delayTimeSec = delayFromBeats(beats, bpm);
	if (Math.abs(delayTimeSec - fx.delayTimeSec) > 0.0005) {
		ctx.state.padParams.setEffects(index, { delayTimeSec, delaySync: true });
		ctx.state.voiceManager?.updateVoiceBaseParams(index, undefined, { delayTimeSec });
	}
}

function applyDelaySyncForAllPads() {
	for (let i = 0; i < ctx.state.padParams.size(); i++) applyDelaySyncForPad(i);
}

function formatDelayBeats(beats: number): string {
	if (Math.abs(beats - 0.125) < 0.01) return '1/32';
	if (Math.abs(beats - 0.25) < 0.01) return '1/16';
	if (Math.abs(beats - 1 / 3) < 0.02) return '1/8T';
	if (Math.abs(beats - 0.5) < 0.01) return '1/8';
	if (Math.abs(beats - 0.75) < 0.01) return '1/8D';
	if (Math.abs(beats - 1) < 0.01) return '1/4';
	if (Math.abs(beats - 1.5) < 0.01) return '1/4D';
	if (Math.abs(beats - 2) < 0.01) return '1/2';
	return beats.toFixed(2);
}

function bufferForPad(index: number): AudioBuffer | null {
	return padAudioBuffers.get(index) ?? ctx.state.buffer;
}

function activeAudioBuffer(): AudioBuffer | null {
	if (ctx.state.activePadIndex != null) return bufferForPad(ctx.state.activePadIndex);
	return ctx.state.buffer;
}

async function remountPadAudioBuffers() {
	if (!ctx.state.voiceManager) return;
	for (let i = 0; i < MAX_PADS; i++) {
		await ctx.state.voiceManager.setBufferForPad(i, padAudioBuffers.get(i) ?? null);
	}
}

function shiftPadAudioAfterDelete(deletedIndex: number) {
	const next: PadAudioSnap[] = [];
	for (const [index, buffer] of padAudioBuffers) {
		if (index === deletedIndex) continue;
		next.push({
			index: index > deletedIndex ? index - 1 : index,
			buffer,
			name: padAudioNames.get(index) ?? `pad-${index + 1}`,
			path: padAudioPaths.get(index) ?? null
		});
	}
	restorePadAudioMaps(next);
}

function showBufferForPad(index: number) {
	const buf = bufferForPad(index);
	if (buf && buf !== lastShownWaveformBuffer) {
		lastShownWaveformBuffer = buf;
		ctx.waveform.setBuffer(buf);
		if (document.getElementById('bufferDur')) {
			document.getElementById('bufferDur')!.textContent = `Duration: ${buf.duration.toFixed(2)}s`;
		}
	}
	ctx.host.recallWaveformSelection(index);
	syncFileNameDisplay();
}

function syncFileNameDisplay() {
	const el = document.getElementById('fileName');
	if (!el) return;
	const idx = ctx.state.activePadIndex;
	if (idx != null && padAudioNames.has(idx)) {
		const name = padAudioNames.get(idx)!;
		el.textContent = name.length > 20 ? name.substring(0, 17) + '...' : name;
		return;
	}
	if (ctx.state.audioName) {
		el.textContent = ctx.state.audioName.length > 20 ? ctx.state.audioName.substring(0, 17) + '...' : ctx.state.audioName;
		return;
	}
	el.textContent = 'No File Loaded';
}

function buildSessionDocument(): UndergrainSession {
	const pads = [];
	const n = Math.max(ctx.state.regions.size(), ctx.state.padParams.size());
	for (let i = 0; i < n; i++) {
		pads.push({
			region: ctx.state.regions.get(i),
			params: clonePadParams(ctx.state.padParams.get(i) ?? emptyPadParams()),
			audioFile: padAudioBuffers.has(i) ? (padAudioNames.get(i) ?? `pad-${i + 1}`) : null,
			audioName: padAudioNames.get(i) ?? null
		});
	}
	return {
		version: 1,
		audio: ctx.state.buffer ? { name: ctx.state.audioName || 'audio.wav', file: ctx.state.audioName || 'audio.wav' } : null,
		scaleIndex: ctx.state.activeScaleIndex,
		xyMode: ctx.host.getXYMode(),
		xyCorners: {
			tl: ctx.customSelectTL?.getValue() || 'filterCutoffHz',
			tr: ctx.customSelectTR?.getValue() || 'density',
			bl: ctx.customSelectBL?.getValue() || 'none',
			br: ctx.customSelectBR?.getValue() || 'none'
		},
		activePadIndex: ctx.state.activePadIndex,
		midiMode: ctx.state.midiMode,
		midiMappings: ctx.state.midi.mappings,
		pads
	};
}

async function applySession(
	session: UndergrainSession,
	loaded: { shared: AudioBuffer | null; padBuffers: Map<number, AudioBuffer>; jsonPath?: string },
	opts?: { promptMissingAudio?: boolean }
) {
	ctx.state.voiceManager?.stopAll();
	ctx.markerSequencer.stopAll();

	const pads = session.pads.slice(0, MAX_PADS);
	if (pads.length === 0) pads.push({ region: null, params: emptyPadParams() });

	ctx.state.regions.replaceAll(pads.map((p) => (p.region ? { ...p.region } : null)));
	ctx.state.padParams.replaceAll(pads.map((p) => clonePadParams(p.params)));
	ctx.state.activePadIndex = session.activePadIndex != null
		? Math.max(0, Math.min(pads.length - 1, session.activePadIndex))
		: 0;
	ctx.state.midiMode = session.midiMode;
	ctx.state.midi.mappings = session.midiMappings;
	saveMappings(ctx.state.midi.mappings);
	ctx.host.applyScaleIndex(session.scaleIndex);
	ctx.host.setXYMode(session.xyMode);
	ctx.host.populateParamSelects();
	ctx.customSelectTL?.setValue(session.xyCorners.tl);
	ctx.customSelectTR?.setValue(session.xyCorners.tr);
	ctx.customSelectBL?.setValue(session.xyCorners.bl);
	ctx.customSelectBR?.setValue(session.xyCorners.br);
	ctx.host.refreshXYCornerLabels();

	padAudioBuffers.clear();
	padAudioNames.clear();
	padAudioPaths.clear();

	if (loaded.shared) {
		ctx.state.buffer = loaded.shared;
		ctx.state.audioName = session.audio?.name || 'audio.wav';
		ctx.state.audioPath = loaded.jsonPath && session.audio?.file
			? joinDir(loaded.jsonPath, session.audio.file)
			: null;
		await ctx.host.ensureEngine();
		ctx.host.ensureEffects();
		await ctx.state.voiceManager?.setBuffer(loaded.shared);
		lastShownWaveformBuffer = null;
		ctx.host.setEmptyState(false);
	} else if (opts?.promptMissingAudio && session.audio) {
		alert('Session audio was not found next to the JSON. Use Load Audio to re-attach it.');
	}

	for (const [i, buf] of loaded.padBuffers) {
		padAudioBuffers.set(i, buf);
		const name = pads[i]?.audioName || pads[i]?.audioFile || `pad-${i + 1}`;
		padAudioNames.set(i, name);
		if (loaded.jsonPath && pads[i]?.audioFile) {
			padAudioPaths.set(i, joinDir(loaded.jsonPath, pads[i].audioFile!));
		}
		ctx.state.padParams.set(i, { audioSource: { kind: 'file', name } });
	}
	await remountPadAudioBuffers();

	ctx.host.updatePadGrid();
	if (ctx.state.activePadIndex != null) {
		showBufferForPad(ctx.state.activePadIndex);
		ctx.host.recallPadParams(ctx.state.activePadIndex, 0);
		ctx.host.refreshMarkerUI();
		ctx.host.syncMarkerEngine(ctx.state.activePadIndex);
		ctx.host.syncXYToPad(ctx.state.activePadIndex, true);
	}
	applyDelaySyncForAllPads();
	syncDelayLabel();
	ctx.tiles?.refreshFromState();
	syncFileNameDisplay();
	clearSessionDirty();
}

async function handleSaveSession() {
	try {
		await ctx.host.ensureAudioReady();
		const path = await saveSessionToDisk(buildSessionDocument(), {
			sharedBuffer: ctx.state.buffer,
			sharedName: ctx.state.audioName,
			sharedPath: ctx.state.audioPath,
			padBuffers: padAudioBuffers,
			padNames: padAudioNames,
			padPaths: padAudioPaths
		});
		if (path) clearSessionDirty();
	} catch (err) {
		logger.error('Save session failed:', err);
		alert(err instanceof Error ? err.message : 'Could not save session.');
	}
}

async function handleOpenSession() {
	try {
		await ctx.host.ensureAudioReady();
		const loaded = await loadSessionFromDisk(ctx.state.contextMgr.audioContext);
		if (!loaded) return;
		await applySession(loaded.session, {
			shared: loaded.shared,
			padBuffers: loaded.padBuffers,
			jsonPath: loaded.jsonPath
		}, { promptMissingAudio: true });
	} catch (err) {
		logger.error('Open session failed:', err);
		alert(err instanceof Error ? err.message : 'Could not open session.');
	}
}

async function maybeRestoreAutosave() {
	try {
		const raw = localStorage.getItem(AUTOSAVE_KEY);
		if (!raw) return;
		const session = parseSession(raw);
		if (!session.pads.length) return;
		if (!window.confirm('Resume last session?')) return;
		await applySession(session, { shared: null, padBuffers: new Map() }, { promptMissingAudio: false });
	} catch {
		// ignore corrupt autosave
	}
}

function syncDelayLabel() {
	const label = document.getElementById('delaySyncLabel');
	if (!label) return;
	const sync = ctx.state.padParams.get(ctx.state.activePadIndex ?? 0)?.effects.delaySync;
	label.textContent = sync ? 'DLY-S' : 'DLY-T';
	label.classList.toggle('is-synced', !!sync);
}

	function bindUi() {
		document.getElementById('sessionSaveBtn')?.addEventListener('click', () => {
			void handleSaveSession();
		});
		document.getElementById('sessionOpenBtn')?.addEventListener('click', () => {
			void handleOpenSession();
		});
		document.getElementById('delaySyncLabel')?.addEventListener('click', () => {
			const index = ctx.state.activePadIndex ?? 0;
			if (!ctx.state.padParams.get(index)) return;
			const next = !ctx.state.padParams.get(index).effects.delaySync;
			ctx.state.padParams.setEffects(index, { delaySync: next });
			if (next) applyDelaySyncForPad(index);
			syncDelayLabel();
			ctx.tiles?.refreshFromState();
			markSessionDirty();
		});
	}

	return {
		pushUndo,
		markDirty: markSessionDirty,
		clearDirty: clearSessionDirty,
		captureProject,
		restoreProject: (snap) => restoreProject(snap as ProjectSnap),
		undo: () => {
			const snap = undoStack.popUndo(captureProject());
			if (snap) undoStack.run(() => restoreProject(snap));
		},
		redo: () => {
			const snap = undoStack.popRedo(captureProject());
			if (snap) undoStack.run(() => restoreProject(snap));
		},
		bufferForPad,
		activeAudioBuffer,
		showBufferForPad,
		shiftPadAudioAfterDelete,
		remountPadAudioBuffers,
		padAudioBuffers,
		padAudioNames,
		padAudioPaths,
		activePadBpm,
		snapDelayBeats,
		delayFromBeats,
		applyDelaySyncForPad,
		applyDelaySyncForAllPads,
		formatDelayBeats,
		syncDelayLabel,
		syncFileNameDisplay,
		buildSessionDocument,
		applySession,
		save: handleSaveSession,
		open: handleOpenSession,
		maybeRestoreAutosave,
		bindUi,
		get lastShownWaveformBuffer() { return lastShownWaveformBuffer; },
		set lastShownWaveformBuffer(v) { lastShownWaveformBuffer = v; }
	};
}
