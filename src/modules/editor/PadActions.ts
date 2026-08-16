import type { AppContext, PadActions } from '../app/AppContext';
import { MAX_PADS, PAD_COLORS } from '../app/AppContext';
import { PAD_ICONS } from '../ui/PadGrid';
import type { Region } from './RegionStore';
import { clonePadParams, emptyPadParams } from '../session/SessionStore';
import { saveMappings } from '../midi/MidiManager';
import { quantizePitch } from '../utils/ScaleQuantizer';

function hexToRgba(hex: string, alpha = 1): string {
	const m = hex.replace('#', '');
	const bigint = parseInt(m.length === 3 ? m.split('').map((c) => c + c).join('') : m, 16);
	const r = (bigint >> 16) & 255;
	const g = (bigint >> 8) & 255;
	const b = bigint & 255;
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function randRange(min: number, max: number) {
	return min + Math.random() * (max - min);
}

export function createPadActions(
	ctx: AppContext,
	opts: { setSkipNextMarkerShift: (value: boolean) => void }
): PadActions {
	const padEditModal = document.getElementById('padEditModal') as HTMLDivElement;
	const padIconGrid = document.getElementById('padIconGrid') as HTMLDivElement;
	const padEditCancel = document.getElementById('padEditCancel') as HTMLButtonElement;
	const padEditSave = document.getElementById('padEditSave') as HTMLButtonElement;
	const padEditDelete = document.getElementById('padEditDelete') as HTMLButtonElement | null;
	const padEditDuplicate = document.getElementById('padEditDuplicate') as HTMLButtonElement | null;
	const padEditRandomize = document.getElementById('padEditRandomize') as HTMLButtonElement | null;
	const padEditLoadAudio = document.getElementById('padEditLoadAudio') as HTMLButtonElement | null;
	const padAudioInput = document.getElementById('padAudioInput') as HTMLInputElement | null;

	let currentEditIndex: number | null = null;
	let pendingRegionUpdate: { start: number; end: number } | null = null;
	let selectedIconIndex: number | null = null;

	function openPadEditModal(index: number, pendingRegion: { start: number; end: number } | null) {
		currentEditIndex = index;
		pendingRegionUpdate = pendingRegion;
		const region = ctx.state.regions.get(index);
		selectedIconIndex = region?.iconIndex ?? null;
		if (padEditDelete) {
			padEditDelete.disabled = !region;
		}

		padIconGrid.innerHTML = '';
		PAD_ICONS.forEach((icon, i) => {
			const div = document.createElement('div');
			div.className = 'icon-option';

			const color = PAD_COLORS[i % PAD_COLORS.length];
			div.style.color = color;
			div.style.borderColor = 'var(--border-subtle)';

			const effectiveIndex = region?.iconIndex !== undefined ? region.iconIndex : (region ? index % PAD_ICONS.length : null);
			const isSelected = selectedIconIndex !== null ? (selectedIconIndex === i) : (effectiveIndex === i);

			if (isSelected) {
				div.classList.add('selected');
				div.style.borderColor = color;
				div.style.backgroundColor = hexToRgba(color, 0.1);
				selectedIconIndex = i;
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

	function deletePad(index: number) {
		ctx.session!.pushUndo();
		ctx.state.voiceManager?.stopAll();
		ctx.markerSequencer.stopAll();
		if (ctx.motionCtrl && ctx.motionCtrl.isPlaying()) {
			ctx.motionCtrl.stop();
		}

		ctx.session!.shiftPadAudioAfterDelete(index);

		ctx.state.regions.remove(index);
		ctx.state.padParams.remove(index);

		ctx.state.midi.mappings = ctx.state.midi.mappings
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
		saveMappings(ctx.state.midi.mappings);

		if (ctx.state.activePadIndex !== null) {
			if (ctx.state.activePadIndex === index) {
				ctx.state.activePadIndex = null;
			} else if (ctx.state.activePadIndex > index) {
				ctx.state.activePadIndex = ctx.state.activePadIndex - 1;
			}
		}

		if (ctx.state.activePadIndex === null) {
			ctx.waveform.clearSelection();
			ctx.host.updateSelPosUI();
			if (ctx.xy.setPosition) ctx.xy.setPosition(0.5, 0.5);
		}

		ctx.host.updatePadGrid();
		if (ctx.host.getXYMode() === 'pads') {
			ctx.host.populateParamSelects();
			ctx.host.refreshXYCornerLabels();
		}

		closePadEditModal();
	}

	function duplicatePad(index: number) {
		if (ctx.state.regions.getAll().length >= MAX_PADS) return;
		ctx.session!.pushUndo();
		const srcRegion = ctx.state.regions.get(index);
		const srcParams = clonePadParams(ctx.state.padParams.get(index) ?? emptyPadParams());
		ctx.state.regions.add();
		ctx.state.padParams.add();
		const next = ctx.state.regions.size() - 1;
		if (srcRegion) ctx.state.regions.set(next, { ...srcRegion });
		ctx.state.padParams.set(next, srcParams);
		const buf = ctx.session!.padAudioBuffers.get(index);
		if (buf) {
			ctx.session!.padAudioBuffers.set(next, buf);
			ctx.session!.padAudioNames.set(next, ctx.session!.padAudioNames.get(index) ?? `pad-${next + 1}`);
			const path = ctx.session!.padAudioPaths.get(index);
			if (path) ctx.session!.padAudioPaths.set(next, path);
			void ctx.state.voiceManager?.setBufferForPad(next, buf);
		}
		ctx.host.updatePadGrid();
		if (ctx.host.getXYMode() === 'pads') {
			ctx.host.populateParamSelects();
			ctx.host.refreshXYCornerLabels();
		}
	}

	function randomizePad(index: number) {
		ctx.session!.pushUndo();
		const granular = {
			grainSizeMs: Math.round(randRange(10, 200)),
			density: Math.round(randRange(1, 60)),
			randomStartMs: Math.round(randRange(0, 200)),
			pitchSemitones: Math.round(randRange(-12, 12))
		};
		const effects = {
			filterCutoffHz: Math.round(randRange(200, 12000)),
			filterQ: randRange(0.3, 8),
			delayTimeSec: randRange(0, 1.2),
			delayMix: randRange(0, 0.6),
			delayFeedback: randRange(0, 0.55),
			reverbMix: randRange(0, 0.7),
			masterGain: randRange(0.5, 1.2),
			reverbRoom: randRange(0.2, 0.9),
			reverbDamp: randRange(0.2, 0.8)
		};
		if (ctx.state.activeScaleIndex !== 0) {
			granular.pitchSemitones = quantizePitch(granular.pitchSemitones, ctx.state.activeScaleIndex);
		}
		ctx.state.padParams.setGranular(index, granular);
		ctx.state.padParams.setEffects(index, effects);
		ctx.state.voiceManager?.updateVoiceBaseParams(index, granular, effects);
		if (ctx.state.activePadIndex === index) {
			ctx.controls!.setGranularUI(granular);
			ctx.controls!.setFxUI(effects);
			ctx.tiles?.refreshFromState();
			ctx.fxVisualizer?.setParams(effects);
		}
	}

	function bindUi() {
		if (padEditCancel) padEditCancel.addEventListener('click', closePadEditModal);

		if (padEditSave) padEditSave.addEventListener('click', () => {
			if (currentEditIndex === null) return;

			const existingRegion = ctx.state.regions.get(currentEditIndex);
			let region: Region;

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

			ctx.state.regions.set(currentEditIndex, region);

			if (ctx.state.activePadIndex === currentEditIndex) {
				const effectiveIconIndex = region.iconIndex !== undefined ? region.iconIndex : currentEditIndex;
				const color = PAD_COLORS[effectiveIconIndex % PAD_COLORS.length];
				ctx.waveform.setColor(color, hexToRgba(color, 0.18));
				if (ctx.motionCtrl) ctx.motionCtrl.setColor(color);
				opts.setSkipNextMarkerShift(true);
				ctx.waveform.setSelection(region.start, region.end);
			}

			ctx.host.updatePadGrid();
			closePadEditModal();
		});

		if (padEditDelete) {
			padEditDelete.addEventListener('click', () => {
				if (currentEditIndex === null) return;
				deletePad(currentEditIndex);
			});
		}

		padEditDuplicate?.addEventListener('click', () => {
			if (currentEditIndex == null) return;
			if (ctx.state.regions.getAll().length >= MAX_PADS) {
				alert('Maximum 3 pads.');
				return;
			}
			const src = currentEditIndex;
			closePadEditModal();
			duplicatePad(src);
		});
		padEditRandomize?.addEventListener('click', () => {
			if (currentEditIndex == null) return;
			randomizePad(currentEditIndex);
		});
		padEditLoadAudio?.addEventListener('click', () => {
			padAudioInput?.click();
		});
		padAudioInput?.addEventListener('change', async (e) => {
			const file = (e.target as HTMLInputElement).files?.[0];
			const index = currentEditIndex;
			(e.target as HTMLInputElement).value = '';
			if (!file || index == null) return;
			await ctx.host.loadAudioFromFile(file, index);
		});
	}

	return {
		openEditModal: openPadEditModal,
		closeEditModal: closePadEditModal,
		deletePad,
		duplicatePad,
		randomizePad,
		bindUi,
		currentEditIndex: () => currentEditIndex
	};
}
