/** Encode interleaved PCM WAV (24-bit). */
export function encodeWav(
	samples: Float32Array[],
	sampleRate: number,
	numChannels: number,
	bitsPerSample: 16 | 24 = 24
): ArrayBuffer {
	const length = samples[0]?.length ?? 0;
	const bytesPerSample = bitsPerSample / 8;
	const dataBytes = length * numChannels * bytesPerSample;
	const buffer = new ArrayBuffer(44 + dataBytes);
	const view = new DataView(buffer);

	const writeString = (offset: number, string: string) => {
		for (let i = 0; i < string.length; i++) {
			view.setUint8(offset + i, string.charCodeAt(i));
		}
	};

	writeString(0, 'RIFF');
	view.setUint32(4, 36 + dataBytes, true);
	writeString(8, 'WAVE');
	writeString(12, 'fmt ');
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, numChannels, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
	view.setUint16(32, numChannels * bytesPerSample, true);
	view.setUint16(34, bitsPerSample, true);
	writeString(36, 'data');
	view.setUint32(40, dataBytes, true);

	let o = 44;
	for (let i = 0; i < length; i++) {
		for (let ch = 0; ch < numChannels; ch++) {
			const s = Math.max(-1, Math.min(1, samples[ch]?.[i] ?? 0));
			if (bitsPerSample === 16) {
				const v = s < 0 ? s * 0x8000 : s * 0x7fff;
				view.setInt16(o, v, true);
				o += 2;
			} else {
				const v = Math.round(s * 0x7fffff);
				view.setUint8(o, v & 0xff);
				view.setUint8(o + 1, (v >> 8) & 0xff);
				view.setUint8(o + 2, (v >> 16) & 0xff);
				o += 3;
			}
		}
	}

	return buffer;
}

export function audioBufferToWav(buffer: AudioBuffer, bitsPerSample: 16 | 24 = 24): ArrayBuffer {
	const channels: Float32Array[] = [];
	const n = Math.min(2, buffer.numberOfChannels);
	for (let ch = 0; ch < n; ch++) {
		channels.push(buffer.getChannelData(ch));
	}
	if (n === 1) channels.push(channels[0]);
	return encodeWav(channels, buffer.sampleRate, 2, bitsPerSample);
}
