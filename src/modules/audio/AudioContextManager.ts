import { logger } from '../utils/logger';

export function createAudioContextManager() {
	const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
	let unlocked = audioContext.state === 'running';

	// Listen for audio context state changes (e.g., suspended by browser)
	const handleStateChange = () => {
		if (audioContext.state === 'suspended' && unlocked) {
			logger.warn('Audio context was suspended by browser');
		}
	};
	audioContext.addEventListener('statechange', handleStateChange);

	async function unlock() {
		if (unlocked) return;
		try {
			await audioContext.resume();
			unlocked = true;
			logger.log('Audio context unlocked successfully');
		} catch (error) {
			logger.error('Failed to unlock audio context:', error);
			// Don't throw - app should continue to work even if unlock fails
			// User can try again later
		}
	}

	return {
		audioContext,
		unlock
	};
}


