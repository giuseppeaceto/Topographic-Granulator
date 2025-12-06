export async function loadAudioBuffer(ctx: AudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
	// slice(0) creates a copy of the ArrayBuffer. 
	// This is important because decodeAudioData detaches the buffer.
	// If the original buffer is needed elsewhere (unlikely here but good practice), copy is needed.
	// Also helps prevents issues if the passed buffer was a view.
	try {
		return await ctx.decodeAudioData(data.slice(0));
	} catch (e) {
		console.error('Error decoding audio data:', e);
		throw new Error('Failed to decode audio file. Format might not be supported.');
	}
}


