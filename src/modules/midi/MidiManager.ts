export type MidiMapping = {
	type: 'cc' | 'note';
	channel: number;
	controller: number; // cc number or note number
	targetId: string;   // e.g., 'knob:pitch' or 'pad:0'
};

export type MidiEvent = { type: 'cc' | 'noteon' | 'noteoff'; channel: number; num: number; value: number };

export class MidiManager {
	private access: WebMidi.MIDIAccess | null = null;
	private inputs: WebMidi.MIDIInput[] = [];
	private listeners: ((e: MidiEvent) => void)[] = [];

	async init(): Promise<boolean> {
		if (!navigator.requestMIDIAccess) return false;
		try {
			this.access = await navigator.requestMIDIAccess({ sysex: false });
			this.refresh();
			this.access.onstatechange = () => this.refresh();
			return true;
		} catch {
			return false;
		}
	}

	private refresh() {
		this.inputs.forEach(inp => (inp.onmidimessage = null));
		this.inputs = [];
		if (!this.access) return;
		for (const inp of this.access.inputs.values()) {
			this.inputs.push(inp);
			inp.onmidimessage = (msg) => this.handleMessage(msg);
		}
	}

	private handleMessage(message: WebMidi.MIDIMessageEvent) {
		const [status, data1, data2] = message.data;
		const statusHigh = status & 0xf0;
		const channel = (status & 0x0f) + 1;
		if (statusHigh === 0xb0) {
			// CC
			const e: MidiEvent = { type: 'cc', channel, num: data1, value: data2 };
			this.emit(e);
		} else if (statusHigh === 0x90) {
			// note on (velocity 0 => off)
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


