import { loadAudioBuffer } from '../utils/audioLoader';

const MAX_FILE_BYTES = 120 * 1024 * 1024; // ~120MB safety cap

export type LoadedAudio = {
	name: string;
	type: string;
	sizeBytes: number;
	arrayBuffer: ArrayBuffer;
	audioBuffer: AudioBuffer;
};

/**
 * Reads and decodes an audio File with basic validation to avoid renderer crashes.
 */
export async function loadAudioFile(ctx: AudioContext, file: File): Promise<LoadedAudio> {
	if (!file) throw new Error('Nessun file selezionato');
	if (!file.type.startsWith('audio/')) throw new Error('Il file non è audio');
	if (file.size === 0) throw new Error('Il file è vuoto');
	if (file.size > MAX_FILE_BYTES) {
		throw new Error(`File troppo grande (${(file.size / (1024 * 1024)).toFixed(1)} MB). Limite ~120MB.`);
	}

	// Read as ArrayBuffer (copy happens inside decode)
	const arrayBuffer = await file.arrayBuffer();
	if (!arrayBuffer || arrayBuffer.byteLength === 0) {
		throw new Error('Impossibile leggere il contenuto del file');
	}

	const audioBuffer = await loadAudioBuffer(ctx, arrayBuffer);

	return {
		name: file.name,
		type: file.type || 'audio/unknown',
		sizeBytes: file.size,
		arrayBuffer,
		audioBuffer
	};
}

