import { audioBufferToWav } from '../audio/wavEncoder';
import { loadAudioBuffer } from '../utils/audioLoader';
import {
	audioBasename,
	joinDir,
	padAudioBasename,
	parseSession,
	stringifySession,
	type UndergrainSession
} from './SessionStore';

function electronAPI(): any {
	return typeof window !== 'undefined' ? (window as any).electronAPI : null;
}

export async function saveSessionToDisk(
	session: UndergrainSession,
	opts: {
		sharedBuffer: AudioBuffer | null;
		sharedName: string | null;
		sharedPath: string | null;
		padBuffers: Map<number, AudioBuffer>;
		padNames: Map<number, string>;
		padPaths: Map<number, string>;
	}
): Promise<string | null> {
	const api = electronAPI();
	if (!api?.showSaveDialog) {
		const blob = new Blob([stringifySession(session)], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = 'session.undergrain.json';
		a.click();
		URL.revokeObjectURL(url);
		return 'download';
	}

	const pick = await api.showSaveDialog({
		title: 'Save Undergrain session',
		defaultPath: 'session.undergrain.json',
		filters: [{ name: 'Undergrain', extensions: ['undergrain.json', 'json'] }]
	});
	if (pick.canceled || !pick.filePath) return null;
	let jsonPath = String(pick.filePath);
	if (!jsonPath.toLowerCase().endsWith('.json')) jsonPath += '.undergrain.json';

	const next: UndergrainSession = { ...session, pads: session.pads.map((p) => ({ ...p })) };

	if (opts.sharedBuffer) {
		const name = opts.sharedName || 'audio.wav';
		const file = audioBasename(jsonPath, name);
		const dest = joinDir(jsonPath, file);
		if (opts.sharedPath) {
			const copied = await api.copyFile(opts.sharedPath, dest);
			if (!copied?.ok) {
				const wav = new Uint8Array(audioBufferToWav(opts.sharedBuffer, 24));
				await api.writeBinaryFile(dest, wav);
			}
		} else {
			const wav = new Uint8Array(audioBufferToWav(opts.sharedBuffer, 24));
			await api.writeBinaryFile(dest, wav);
		}
		next.audio = { name, file };
	}

	for (let i = 0; i < next.pads.length; i++) {
		const buf = opts.padBuffers.get(i);
		if (!buf) {
			next.pads[i].audioFile = null;
			continue;
		}
		const name = opts.padNames.get(i) || `pad-${i + 1}.wav`;
		const file = padAudioBasename(jsonPath, i, name);
		const dest = joinDir(jsonPath, file);
		const srcPath = opts.padPaths.get(i);
		if (srcPath) {
			const copied = await api.copyFile(srcPath, dest);
			if (!copied?.ok) {
				const wav = new Uint8Array(audioBufferToWav(buf, 24));
				await api.writeBinaryFile(dest, wav);
			}
		} else {
			const wav = new Uint8Array(audioBufferToWav(buf, 24));
			await api.writeBinaryFile(dest, wav);
		}
		next.pads[i].audioFile = file;
		next.pads[i].audioName = name;
	}

	await api.writeTextFile(jsonPath, stringifySession(next));
	return jsonPath;
}

export async function loadSessionFromDisk(
	ctx: AudioContext
): Promise<{ session: UndergrainSession; jsonPath: string; shared: AudioBuffer | null; padBuffers: Map<number, AudioBuffer> } | null> {
	const api = electronAPI();
	if (!api?.showOpenDialog) {
		return new Promise((resolve) => {
			const input = document.createElement('input');
			input.type = 'file';
			input.accept = '.json,.undergrain.json';
			input.onchange = async () => {
				const file = input.files?.[0];
				if (!file) {
					resolve(null);
					return;
				}
				try {
					const session = parseSession(await file.text());
					resolve({ session, jsonPath: file.name, shared: null, padBuffers: new Map() });
				} catch {
					resolve(null);
				}
			};
			input.click();
		});
	}

	const pick = await api.showOpenDialog({
		title: 'Open Undergrain session',
		filters: [{ name: 'Undergrain', extensions: ['undergrain.json', 'json'] }]
	});
	if (pick.canceled || !pick.filePaths?.[0]) return null;
	const jsonPath = String(pick.filePaths[0]);
	const read = await api.readTextFile(jsonPath);
	if (!read?.ok) throw new Error(read?.error || 'Could not read session');
	const session = parseSession(read.data);

	const padBuffers = new Map<number, AudioBuffer>();
	let shared: AudioBuffer | null = null;

	async function readAudio(fileName: string): Promise<AudioBuffer> {
		const path = joinDir(jsonPath, fileName);
		const bin = await api.readBinaryFile(path);
		if (!bin?.ok) throw new Error(`Missing audio file: ${fileName}`);
		const bytes = bin.data as Uint8Array;
		const copy = new ArrayBuffer(bytes.byteLength);
		new Uint8Array(copy).set(bytes);
		return loadAudioBuffer(ctx, copy);
	}

	if (session.audio?.file) {
		try {
			shared = await readAudio(session.audio.file);
		} catch (err) {
			console.warn(err);
		}
	}
	for (let i = 0; i < session.pads.length; i++) {
		const file = session.pads[i].audioFile;
		if (!file) continue;
		try {
			padBuffers.set(i, await readAudio(file));
		} catch (err) {
			console.warn(err);
		}
	}

	return { session, jsonPath, shared, padBuffers };
}
