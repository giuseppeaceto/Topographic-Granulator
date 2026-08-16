import type { AppContext, MidiApp } from '../app/AppContext';
import { PAD_COLORS } from '../app/AppContext';
import { MidiManager, saveMappings } from './MidiManager';
import { quantizePitch } from '../utils/ScaleQuantizer';
import { logger } from '../utils/logger';

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
	const midiLearnEl = document.getElementById('midiLearn') as HTMLInputElement | null;
	const midiClearBtn = document.getElementById('midiClear') as HTMLButtonElement | null;

	let midiClockLast = 0;
	let midiClockBpm = 120;

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
			const pad = document.querySelector(`.pad-grid .pad[data-index="${idx}"]`) as HTMLElement | null;
			pad?.classList.add('learn-pending');
		}
	}

	function applyMidiToTarget(targetId: string, norm: number) {
		if (targetId.startsWith('knob:')) {
			const id = targetId.slice(5);
			const cfg = ctx.tiles?.findConfig(id);
			if (!cfg) return;
			const value = cfg.min + norm * (cfg.max - cfg.min);
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

	async function initMIDI(): Promise<boolean> {
		ctx.state.midi.manager = new MidiManager();
		const ok = await ctx.state.midi.manager.init();
		if (!ok) return false;
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
				ctx.markerSequencer.stopAll();
				return;
			}
			if (e.type === 'cc') {
				if (ctx.state.midi.learnEnabled && ctx.state.midi.pendingTarget) {
					ctx.state.midi.mappings = ctx.state.midi.mappings.filter(m => m.targetId !== ctx.state.midi.pendingTarget);
					ctx.state.midi.mappings.push({ type: 'cc', channel: e.channel, controller: e.num, targetId: ctx.state.midi.pendingTarget });
					saveMappings(ctx.state.midi.mappings);
					ctx.state.midi.pendingTarget = null;
					highlightPending(null);
					return;
				}
				const mapping = ctx.state.midi.mappings.find(m => m.type === 'cc' && m.channel === e.channel && m.controller === e.num);
				if (mapping) {
					const norm = Math.max(0, Math.min(1, e.value / 127));
					applyMidiToTarget(mapping.targetId, norm);
				}
			} else if (e.type === 'noteon') {
				const mapping = ctx.state.midi.mappings.find(m => m.type === 'note' && m.channel === e.channel && m.controller === e.num);
				if (mapping && mapping.targetId.startsWith('pad:')) {
					const index = Number(mapping.targetId.split(':')[1]);
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
				} else if (ctx.state.midi.learnEnabled && ctx.state.midi.pendingTarget?.startsWith('pad:')) {
					ctx.state.midi.mappings = ctx.state.midi.mappings.filter(m => m.targetId !== ctx.state.midi.pendingTarget);
					ctx.state.midi.mappings.push({ type: 'note', channel: e.channel, controller: e.num, targetId: ctx.state.midi.pendingTarget });
					saveMappings(ctx.state.midi.mappings);
					ctx.state.midi.pendingTarget = null;
					highlightPending(null);
				} else if (ctx.state.midiMode === 'keys' && ctx.state.activePadIndex != null) {
					handleMidiKeyOn(e.num, e.value);
				}
			} else if (e.type === 'noteoff') {
				const mapping = ctx.state.midi.mappings.find(m => m.type === 'note' && m.channel === e.channel && m.controller === e.num);
				if (mapping && mapping.targetId.startsWith('pad:')) {
					const index = Number(mapping.targetId.split(':')[1]);
					ctx.state.voiceManager?.stopPad(index);
					ctx.host.updateSidebarStatus();
				} else if (ctx.state.midiMode === 'keys') {
					handleMidiKeyOff(e.num);
				}
			}
		});
		return true;
	}

	if (midiLearnEl) {
		midiLearnEl.addEventListener('change', async () => {
			ctx.state.midi.learnEnabled = midiLearnEl.checked;
			ctx.state.midi.pendingTarget = null;
			highlightPending(null);
			const knobEl = document.querySelector('.knob[data-knob="midi-learn"]') as HTMLElement | null;
			const valEl = document.querySelector('.tile-value[data-val="midi-learn"]') as HTMLElement | null;
			if (knobEl && valEl) {
				const cfg = ctx.tiles?.findConfig('midi-learn');
				if (cfg) {
					const value = ctx.state.midi.learnEnabled ? 1 : 0;
					valEl.textContent = cfg.format(value);
					if (knobEl.classList.contains('toggle-switch-knob')) {
						knobEl.classList.toggle('active', ctx.state.midi.learnEnabled);
					} else {
						ctx.tiles?.updateKnobAngle(knobEl, value, cfg);
					}
				}
			}
			if (ctx.state.midi.learnEnabled && !ctx.state.midi.manager) {
				const ok = await initMIDI();
				if (!ok) {
					logger.warn('Web MIDI not available or permission not granted.');
					alert('Unable to enable MIDI. Check browser permission and try again (Chrome/Edge).');
					midiLearnEl.checked = false;
					ctx.state.midi.learnEnabled = false;
				}
			}
		});
	}
	if (midiClearBtn) {
		midiClearBtn.addEventListener('click', () => {
			ctx.state.midi.mappings = [];
			saveMappings(ctx.state.midi.mappings);
		});
	}

	return {
		init: initMIDI,
		applyToTarget: applyMidiToTarget,
		highlightPending,
		handleKeyOn: handleMidiKeyOn,
		handleKeyOff: handleMidiKeyOff
	};
}
