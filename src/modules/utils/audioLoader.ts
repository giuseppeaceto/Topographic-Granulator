export async function loadAudioBuffer(ctx: AudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
	return await ctx.decodeAudioData(data.slice(0));
}


