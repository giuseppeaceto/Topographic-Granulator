import type { GranularParams } from '../granular/GranularWorkletEngine';
import type { EffectsParams } from '../effects/EffectsChain';

type ControlHandlers = {
	onParams: (p: Partial<GranularParams>) => void;
	onFX: (fx: Partial<EffectsParams>) => void;
};

export function setupControls(handlers: ControlHandlers) {
	function bindRange(id: string, onChange: (v: number) => void) {
		const el = document.getElementById(id) as HTMLInputElement | null;
		const valEl = document.getElementById(id + 'Val') as HTMLElement | null;
		if (!el || !valEl) return; // control not present (replaced by tile)
		const update = () => {
			const v = Number(el.value);
			valEl.textContent = String(v);
			onChange(v);
		};
		el.addEventListener('input', update);
		update();
	}

	// Granular
	bindRange('grainSize', (v) => handlers.onParams({ grainSizeMs: v }));
	bindRange('density', (v) => handlers.onParams({ density: v }));
	bindRange('randomStart', (v) => handlers.onParams({ randomStartMs: v }));
	bindRange('pitch', (v) => handlers.onParams({ pitchSemitones: v }));

	// FX
	bindRange('filterCutoff', (v) => handlers.onFX({ filterCutoffHz: v }));
	bindRange('delayTime', (v) => handlers.onFX({ delayTimeSec: v }));
	bindRange('delayMix', (v) => handlers.onFX({ delayMix: v }));
	bindRange('reverbMix', (v) => handlers.onFX({ reverbMix: v }));
	bindRange('masterGain', (v) => handlers.onFX({ masterGain: v }));

	// Programmatic UI updates (silent)
	function setGranularUI(p: Partial<GranularParams>) {
		if (p.grainSizeMs != null) setSlider('grainSize', p.grainSizeMs);
		if (p.density != null) setSlider('density', p.density);
		if (p.randomStartMs != null) setSlider('randomStart', p.randomStartMs);
		if (p.pitchSemitones != null) setSlider('pitch', p.pitchSemitones);
	}
	function setFxUI(fx: Partial<EffectsParams>) {
		if (fx.filterCutoffHz != null) setSlider('filterCutoff', fx.filterCutoffHz);
		if (fx.delayTimeSec != null) setSlider('delayTime', fx.delayTimeSec);
		if (fx.delayMix != null) setSlider('delayMix', fx.delayMix);
		if (fx.reverbMix != null) setSlider('reverbMix', fx.reverbMix);
		if (fx.masterGain != null) setSlider('masterGain', fx.masterGain);
	}
	function readGranularUI(): GranularParams {
		return {
			grainSizeMs: getSlider('grainSize'),
			density: getSlider('density'),
			randomStartMs: getSlider('randomStart'),
			pitchSemitones: getSlider('pitch')
		};
	}
	function readFxUI(): EffectsParams {
		return {
			filterCutoffHz: getSlider('filterCutoff'),
			delayTimeSec: getSlider('delayTime'),
			delayMix: getSlider('delayMix'),
			reverbMix: getSlider('reverbMix'),
			masterGain: getSlider('masterGain')
		};
	}

	function setSlider(id: string, value: number) {
		const el = document.getElementById(id) as HTMLInputElement | null;
		const valEl = document.getElementById(id + 'Val') as HTMLElement | null;
		if (!el || !valEl) return;
		el.value = String(value);
		valEl.textContent = String(value);
	}
	function getSlider(id: string): number {
		const el = document.getElementById(id) as HTMLInputElement;
		return Number(el.value);
	}

	return { setGranularUI, setFxUI, readGranularUI, readFxUI };
}


