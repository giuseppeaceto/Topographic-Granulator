export function createAudioContextManager() {
	const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
	let unlocked = audioContext.state === 'running';

	async function unlock() {
		if (unlocked) return;
		try {
			await audioContext.resume();
			unlocked = true;
		} catch {
			// ignore
		}
	}

	return {
		audioContext,
		unlock
	};
}


