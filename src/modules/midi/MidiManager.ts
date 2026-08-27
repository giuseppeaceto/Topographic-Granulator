import { logger } from '../utils/logger';

export type MidiMapping = {
	type: 'cc' | 'note';
	channel: number;
	controller: number; // cc number or note number
	targetId: string;   // e.g., 'knob:pitch' or 'pad:0' or 'marker:0:2'
};

export function parseMarkerTarget(targetId: string): { padIndex: number; sliceIndex: number } | null {
	const m = /^marker:(\d+):(\d+)$/.exec(targetId);
	if (!m) return null;
	return { padIndex: Number(m[1]), sliceIndex: Number(m[2]) };
}

export function markerTargetId(padIndex: number, sliceIndex: number): string {
	return `marker:${padIndex}:${sliceIndex}`;
}

export type MidiEvent =
	| { type: 'cc' | 'noteon' | 'noteoff'; channel: number; num: number; value: number }
	| { type: 'clock' }
	| { type: 'clockstart' }
	| { type: 'clockstop' };

export class MidiManager {
	private access: MIDIAccess | null = null;
	private inputs: MIDIInput[] = [];
	private listeners: ((e: MidiEvent) => void)[] = [];
	private inputListeners: Array<() => void> = [];
	private lastStatus = 0;
	private readonly onMidiMessage = (message: Event) => {
		this.handleMessage(message as MIDIMessageEvent);
	};

	async init(): Promise<boolean> {
		if (!navigator.requestMIDIAccess) {
			logger.warn('Web MIDI API is not available in this runtime.');
			return false;
		}
		try {
			this.access = await navigator.requestMIDIAccess({ sysex: false });
			this.refresh();
			this.access.onstatechange = () => this.refresh();
			const names = this.getInputNames();
			logger.log('MIDI ready. Inputs:', names.length ? names.join(', ') : '(none yet)');
			return true;
		} catch (err) {
			logger.error('MIDI access failed:', err);
			return false;
		}
	}

	getInputNames(): string[] {
		return this.inputs.map((inp) => inp.name || inp.manufacturer || inp.id).filter(Boolean);
	}

	onInputsChange(cb: () => void) {
		this.inputListeners.push(cb);
	}

	private refresh() {
		this.inputs.forEach((inp) => {
			inp.onmidimessage = null;
		});
		this.inputs = [];
		if (!this.access) return;
		for (const inp of this.access.inputs.values()) {
			this.inputs.push(inp);
			// Chromium Web MIDI reliably delivers via onmidimessage; addEventListener is flaky in Electron.
			inp.onmidimessage = this.onMidiMessage;
		}
		this.inputListeners.forEach((cb) => cb());
	}

	private handleMessage(message: MIDIMessageEvent) {
		const raw = message.data;
		if (!raw || raw.length === 0) return;
		const src = raw instanceof Uint8Array
			? raw
			: ArrayBuffer.isView(raw)
				? new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)
				: new Uint8Array(raw as ArrayBuffer);
		let status: number;
		let data1 = 0;
		let data2 = 0;
		if (src[0] < 0x80) {
			if (this.lastStatus < 0x80) return;
			status = this.lastStatus;
			data1 = src[0] ?? 0;
			data2 = src[1] ?? 0;
		} else {
			status = src[0];
			data1 = src[1] ?? 0;
			data2 = src[2] ?? 0;
			if (status < 0xf0) this.lastStatus = status;
			else if (status < 0xf8) this.lastStatus = 0;
		}
		if (status === 0xf8) {
			this.emit({ type: 'clock' });
			return;
		}
		if (status === 0xfa) {
			this.emit({ type: 'clockstart' });
			return;
		}
		if (status === 0xfc) {
			this.emit({ type: 'clockstop' });
			return;
		}
		if (status >= 0xf0) return;
		const statusHigh = status & 0xf0;
		const channel = (status & 0x0f) + 1;
		if (statusHigh === 0xb0) {
			this.emit({ type: 'cc', channel, num: data1, value: data2 });
		} else if (statusHigh === 0x90) {
			if (data2 > 0) {
				this.emit({ type: 'noteon', channel, num: data1, value: data2 });
			} else {
				this.emit({ type: 'noteoff', channel, num: data1, value: 0 });
			}
		} else if (statusHigh === 0x80) {
			this.emit({ type: 'noteoff', channel, num: data1, value: 0 });
		}
	}

	on(cb: (e: MidiEvent) => void) {
		this.listeners.push(cb);
	}

	/**
	 * Remove an event listener
	 * @param cb - The callback function to remove
	 */
	off(cb: (e: MidiEvent) => void) {
		this.listeners = this.listeners.filter(l => l !== cb);
	}

	private emit(e: MidiEvent) {
		this.listeners.forEach((cb) => cb(e));
	}

	/**
	 * Cleanup method to release all resources
	 * Should be called when MidiManager is no longer needed
	 */
	destroy() {
		// Remove all listeners
		this.listeners = [];
		
		// Remove event handlers from MIDI inputs
		this.inputListeners = [];
		this.inputs.forEach(inp => {
			inp.onmidimessage = null;
		});
		this.inputs = [];

		// Clear MIDI access
		if (this.access) {
			this.access.onstatechange = null;
			this.access = null;
		}
	}
}

// Persistence helpers
const STORAGE_KEY = 'granular-midi-mappings';
export function loadMappings(): MidiMapping[] {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		return raw ? (JSON.parse(raw) as MidiMapping[]) : [];
	} catch {
		return [];
	}
}
export function saveMappings(mappings: MidiMapping[]) {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(mappings));
	} catch {}
}


