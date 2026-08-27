import type { AppContext, MidiApp } from '../app/AppContext';
import { PAD_COLORS } from '../app/AppContext';
import { MidiManager, saveMappings, parseMarkerTarget } from './MidiManager';
import { quantizePitch } from '../utils/ScaleQuantizer';

function hexToRgba(hex: string, alpha = 1): string {
	const m = hex.replace('#', '');
	const bigint = parseInt(m.length === 3 ? m.split('').map((c) => c + c).join('') : m, 16);
	const r = (bigint >> 16) & 255;
	const g = (bigint >> 8) & 255;
	const b = bigint & 255;
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function createMidiApp(
	ctx: AppContext,
	opts: { resetXyKeyboard: () => void }
): MidiApp {
	const midiClearBtn = document.getElementById('midiClear') as HTMLButtonElement | null;
	const midiMonitorEl = document.getElementById('midiInMonitor') as HTMLButtonElement | null;
	const midiLedEl = document.getElementById('midiInLed');
	const midiMetaEl = document.getElementById('midiInMeta');
	const midiChipEl = document.getElementById('sidebarStatusMidi');

	let midiClockLast = 0;
	let midiClockBpm = 120;
	let activityTimer = 0;
	let inputsBound = false;

	function shortMidiName(name: string): string {
		const cleaned = name.replace(/\s+MIDI(\s+In(put)?)?$/i, '').trim() || name;
		return cleaned.length > 16 ? `${cleaned.slice(0, 15)}…` : cleaned;
	}

	function setMidiStatus(text: string, connected: boolean, chipTitle?: string) {
		if (midiMetaEl) midiMetaEl.textContent = text;
		midiMonitorEl?.classList.toggle('is-on', connected);
		midiMonitorEl?.classList.toggle('is-off', !connected);
		midiMonitorEl?.setAttribute('aria-label', connected ? `MIDI input: ${text}` : `MIDI ${text}`);
		if (midiChipEl && !midiChipEl.classList.contains('is-flash')) {
			midiChipEl.textContent = 'MIDI';
			midiChipEl.classList.toggle('is-on', connected);
			midiChipEl.title = chipTitle ?? (connected ? `MIDI input: ${text}` : 'MIDI off — click to enable');
		}
	}

	function refreshMidiStatus() {
		const mgr = ctx.state.midi.manager;
		if (!mgr) {
			setMidiStatus('OFF', false, 'MIDI off — click to enable');
			return;
		}
		const names = mgr.getInputNames();
		if (!names.length) {
			setMidiStatus('NO IN', false, 'MIDI on, no controller found');
			return;
		}
		const label = names.length === 1 ? shortMidiName(names[0]) : `${names.length} IN`;
		setMidiStatus(label, true, `MIDI input: ${names.join(', ')}`);
	}

	function pulseMidiActivity(label: string, chipLabel = label) {
		if (midiLedEl) {
			midiLedEl.classList.remove('is-flash');
			void midiLedEl.offsetWidth;
			midiLedEl.classList.add('is-flash');
		}
		if (midiMetaEl) midiMetaEl.textContent = label;
		if (midiChipEl) {
			midiChipEl.classList.add('is-on', 'is-flash');
			midiChipEl.textContent = chipLabel;
		}
		window.clearTimeout(activityTimer);
		activityTimer = window.setTimeout(() => {
			midiLedEl?.classList.remove('is-flash');
			midiChipEl?.classList.remove('is-flash');
			refreshMidiStatus();
		}, 900);
	}

	function findNoteMaps(channel: number, num: number) {
		const notes = ctx.state.midi.mappings.filter(m => m.type === 'note' && m.controller === num);
		const sameCh = notes.filter(m => m.channel === channel);
		return sameCh.length ? sameCh : notes;
	}

	function ccMapping(channel: number, num: number) {
		const ccs = ctx.state.midi.mappings.filter(m => m.type === 'cc' && m.controller === num);
		return ccs.find(m => m.channel === channel) ?? ccs[0] ?? null;
	}

	function highlightPending(target: string | null) {
		document.querySelectorAll('.param-tile').forEach(el => el.classList.remove('learn-pending'));
		document.querySelectorAll('.pad').forEach(el => el.classList.remove('learn-pending'));
		document.querySelectorAll('.marker-slice').forEach(el => el.classList.remove('learn-pending'));
		if (!target) return;
		if (target.startsWith('knob:')) {
			const id = target.slice(5);
			const tile = document.querySelector(`.param-tile [data-knob="${id}"]`)?.closest('.param-tile') as HTMLElement | null;
			tile?.classList.add('learn-pending');
		} else if (target.startsWith('pad:')) {
			const idx = Number(target.split(':')[1]);
			const pad = document.querySelector(`.pad-grid .pad[data-index="${idx}"]`) as HTMLElement | null;
			pad?.classList.add('learn-pending');
		} else if (target.startsWith('marker:')) {
			const parsed = parseMarkerTarget(target);
			if (parsed && parsed.padIndex === ctx.state.activePadIndex) {
				document.querySelector(`.marker-slice[data-slice="${parsed.sliceIndex}"]`)?.classList.add('learn-pending');
			}
		}
	}

	function applyMidiToTarget(targetId: string, norm: number) {
		if (targetId.startsWith('knob:')) {
			const id = targetId.slice(5);
			const cfg = ctx.tiles?.findConfig(id);
			if (!cfg) return;
			const min = cfg.getMin?.() ?? cfg.min;
			const max = cfg.getMax?.() ?? cfg.max;
			const value = cfg.fromNorm ? cfg.fromNorm(norm, min, max) : min + norm * (max - min);
			cfg.set(value);
			const knobEl = document.querySelector(`.knob[data-knob="${cfg.id}"]`) as HTMLElement | null;
			const valEl = document.querySelector(`.tile-value[data-val="${cfg.id}"]`) as HTMLElement | null;
			if (knobEl) ctx.tiles?.updateKnobAngle(knobEl, value, cfg);
			if (valEl) valEl.textContent = cfg.format(value);
		}
	}

	function handleMidiKeyOn(note: number, velocity: number) {
		const padIndex = ctx.state.activePadIndex;
		if (padIndex == null || !ctx.state.regions.get(padIndex)) return;
		const vel = Math.max(1, velocity) / 127;
		let pitch = note - 60;
		if (ctx.state.activeScaleIndex !== 0) pitch = quantizePitch(pitch, ctx.state.activeScaleIndex);
		const gain = 0.25 + vel * 1.1;
		const density = Math.round(8 + vel * 40);
		if (!ctx.heldMidiNotes.includes(note)) ctx.heldMidiNotes.push(note);
		ctx.state.padParams.setGranular(padIndex, { pitchSemitones: pitch, density });
		ctx.state.padParams.setEffects(padIndex, { masterGain: gain });
		ctx.state.voiceManager?.updateVoiceBaseParams(padIndex, { pitchSemitones: pitch, density }, { masterGain: gain });
		if (!ctx.state.voiceManager?.isPadPlaying(padIndex)) {
			void ctx.host.triggerPad(padIndex);
		}
	}

	function handleMidiKeyOff(note: number) {
		const idx = ctx.heldMidiNotes.indexOf(note);
		if (idx >= 0) ctx.heldMidiNotes.splice(idx, 1);
		const padIndex = ctx.state.activePadIndex;
		if (padIndex == null) return;
		if (ctx.heldMidiNotes.length === 0) {
			ctx.state.voiceManager?.stopPad(padIndex);
			ctx.host.updateSidebarStatus();
			return;
		}
		const last = ctx.heldMidiNotes[ctx.heldMidiNotes.length - 1];
		let pitch = last - 60;
		if (ctx.state.activeScaleIndex !== 0) pitch = quantizePitch(pitch, ctx.state.activeScaleIndex);
		ctx.state.padParams.setGranular(padIndex, { pitchSemitones: pitch });
		ctx.state.voiceManager?.updateVoiceBaseParams(padIndex, { pitchSemitones: pitch });
	}

	let midiHandlerBound = false;
	let initInFlight: Promise<boolean> | null = null;

	function bindMidiHandler() {
		if (!ctx.state.midi.manager || midiHandlerBound) return;
		midiHandlerBound = true;
		if (!inputsBound) {
			inputsBound = true;
			ctx.state.midi.manager.onInputsChange(() => refreshMidiStatus());
		}
		refreshMidiStatus();
		ctx.state.midi.manager.on((e) => {
			if (e.type === 'clock') {
				const now = performance.now();
				if (midiClockLast > 0) {
					const dt = now - midiClockLast;
					if (dt > 5 && dt < 200) {
						const instant = 60000 / (dt * 24);
						midiClockBpm = midiClockBpm * 0.85 + instant * 0.15;
						const bpm = Math.round(Math.max(40, Math.min(200, midiClockBpm)));
						for (let i = 0; i < ctx.state.padParams.size(); i++) {
							ctx.state.padParams.setMarkerSeq(i, { bpm });
							ctx.host.syncMarkerEngine(i);
						}
						ctx.session!.applyDelaySyncForAllPads();
						if (ctx.state.activePadIndex != null) ctx.host.refreshMarkerUI();
					}
				}
				midiClockLast = now;
				return;
			}
			if (e.type === 'clockstart') {
				pulseMidiActivity('START');
				for (let i = 0; i < ctx.state.padParams.size(); i++) {
					const seq = ctx.host.getMarkerSeq(i);
					if (seq.enabled) {
						ctx.state.padParams.setMarkerSeq(i, { enabled: true });
						ctx.host.syncMarkerEngine(i);
					}
				}
				return;
			}
			if (e.type === 'clockstop') {
				pulseMidiActivity('STOP');
				ctx.markerSequencer.stopAll();
				return;
			}
			if (e.type === 'cc') {
				pulseMidiActivity(`CC${e.num} ${e.value}`, `CC${e.num}`);
				if (ctx.state.midi.learnEnabled && ctx.state.midi.pendingTarget) {
					const pending = ctx.state.midi.pendingTarget;
					if (pending.startsWith('pad:') || pending.startsWith('marker:')) return;
					ctx.state.midi.mappings = ctx.state.midi.mappings.filter(m => m.targetId !== pending);
					ctx.state.midi.mappings.push({ type: 'cc', channel: e.channel, controller: e.num, targetId: pending });
					saveMappings(ctx.state.midi.mappings);
					ctx.state.midi.pendingTarget = null;
					highlightPending(null);
					return;
				}
				const mapping = ccMapping(e.channel, e.num);
				if (mapping) {
					const norm = Math.max(0, Math.min(1, e.value / 127));
					applyMidiToTarget(mapping.targetId, norm);
				}
			} else if (e.type === 'noteon') {
				pulseMidiActivity(`N${e.num} CH${e.channel}`, `N${e.num}`);
				if (ctx.state.midi.learnEnabled && ctx.state.midi.pendingTarget) {
					const pending = ctx.state.midi.pendingTarget;
					if (pending.startsWith('pad:') || pending.startsWith('marker:')) {
						ctx.state.midi.mappings = ctx.state.midi.mappings.filter(m => m.targetId !== pending);
						ctx.state.midi.mappings.push({ type: 'note', channel: e.channel, controller: e.num, targetId: pending });
						saveMappings(ctx.state.midi.mappings);
						ctx.state.midi.pendingTarget = null;
						highlightPending(null);
						ctx.host.refreshMarkerUI();
						return;
					}
				}
				const maps = findNoteMaps(e.channel, e.num);
				const padMap = maps.find(m => m.targetId.startsWith('pad:'));
				const markerMap = maps.find(m => parseMarkerTarget(m.targetId));
				if (padMap) {
					const index = Number(padMap.targetId.split(':')[1]);
					const prevIndex = ctx.state.activePadIndex;
					if (prevIndex !== index) {
						opts.resetXyKeyboard();
					}
					ctx.state.activePadIndex = index;
					ctx.host.snapshotBaseFromCurrentPad();

					if (ctx.state.recallPerPad) {
						ctx.host.recallPadParams(index, 0, prevIndex ?? null);
						const region = ctx.state.regions.get(index);
						const effectiveIndex = region?.iconIndex !== undefined ? region.iconIndex : index;
						const c = PAD_COLORS[effectiveIndex % PAD_COLORS.length];
						ctx.waveform.setColor(c, hexToRgba(c, 0.18));
					} else {
						ctx.host.recallWaveformSelection(index);
					}
					ctx.host.updateSelPosUI();

					void ctx.host.triggerPad(index);
				} else if (markerMap) {
					const marker = parseMarkerTarget(markerMap.targetId);
					if (marker) {
						void ctx.host.playMarkerSlice(marker.padIndex, marker.sliceIndex, e.value);
					}
				} else if (ctx.state.midiMode === 'keys' && ctx.state.activePadIndex != null) {
					handleMidiKeyOn(e.num, e.value);
				}
			} else if (e.type === 'noteoff') {
				pulseMidiActivity(`N${e.num} ↑`, `N${e.num}`);
				const maps = findNoteMaps(e.channel, e.num);
				const padMap = maps.find(m => m.targetId.startsWith('pad:'));
				const markerMap = maps.find(m => parseMarkerTarget(m.targetId));
				if (padMap) {
					const index = Number(padMap.targetId.split(':')[1]);
					ctx.state.voiceManager?.stopPad(index);
					ctx.host.updateSidebarStatus();
				} else if (markerMap) {
					const marker = parseMarkerTarget(markerMap.targetId);
					if (marker) {
						ctx.host.releaseMarkerSlice(marker.padIndex, marker.sliceIndex);
					}
				} else if (ctx.state.midiMode === 'keys') {
					handleMidiKeyOff(e.num);
				}
			}
		});
	}

	async function initMIDI(): Promise<boolean> {
		if (ctx.state.midi.manager) {
			bindMidiHandler();
			refreshMidiStatus();
			return true;
		}
		if (initInFlight) return initInFlight;
		initInFlight = (async () => {
			const manager = new MidiManager();
			const ok = await manager.init();
			if (!ok) {
				manager.destroy();
				refreshMidiStatus();
				return false;
			}
			ctx.state.midi.manager = manager;
			bindMidiHandler();
			refreshMidiStatus();
			return true;
		})();
		const ok = await initInFlight;
		if (!ok) initInFlight = null;
		return ok;
	}

	const armMidiOnGesture = () => {
		window.removeEventListener('pointerdown', armMidiOnGesture, true);
		window.removeEventListener('keydown', armMidiOnGesture, true);
		void initMIDI();
	};
	window.addEventListener('pointerdown', armMidiOnGesture, true);
	window.addEventListener('keydown', armMidiOnGesture, true);

	midiMonitorEl?.addEventListener('click', (e) => {
		e.stopPropagation();
		void initMIDI().then((ok) => {
			refreshMidiStatus();
			if (!ok) {
				alert('MIDI access was blocked. Restart the app, click this MIDI indicator, and allow MIDI if asked. Plug the controller in before opening Undergrain.');
			}
		});
	});
	midiChipEl?.addEventListener('click', () => {
		ctx.sidebarNav.setView('io');
		void initMIDI();
	});

	if (midiClearBtn) {
		midiClearBtn.addEventListener('click', () => {
			ctx.state.midi.mappings = [];
			saveMappings(ctx.state.midi.mappings);
			ctx.host.refreshMarkerUI();
		});
	}

	refreshMidiStatus();

	return {
		init: initMIDI,
		applyToTarget: applyMidiToTarget,
		highlightPending,
		handleKeyOn: handleMidiKeyOn,
		handleKeyOff: handleMidiKeyOff
	};
}
