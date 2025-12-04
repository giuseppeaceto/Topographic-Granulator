export type VideoRecorder = {
	start: () => Promise<void>;
	stop: () => Promise<Blob | null>;
	isRecording: () => boolean;
	getDuration: () => number;
};

export function createVideoRecorder(
	audioContext: AudioContext,
	audioNode: AudioNode
): VideoRecorder {
	let mediaRecorder: MediaRecorder | null = null;
	let screenStream: MediaStream | null = null;
	let audioStream: MediaStream | null = null;
	let combinedStream: MediaStream | null = null;
	let recordedChunks: Blob[] = [];
	let startTime: number = 0;
	let isActive = false;

	async function start(): Promise<void> {
		if (isActive) return;

		try {
			// Capture screen (video only, no system audio)
			screenStream = await navigator.mediaDevices.getDisplayMedia({
				video: {
					displaySurface: 'browser',
					width: { ideal: 1920 },
					height: { ideal: 1080 },
					frameRate: { ideal: 30 }
				} as MediaTrackConstraints,
				audio: false // We'll use our app's audio instead
			});

			// Create audio stream from our AudioContext
			const audioDestination = audioContext.createMediaStreamDestination();
			audioNode.connect(audioDestination);
			audioStream = audioDestination.stream;

			// Combine video from screen and audio from app
			combinedStream = new MediaStream();
			
			// Add video tracks from screen
			screenStream.getVideoTracks().forEach(track => {
				combinedStream!.addTrack(track);
			});

			// Add audio tracks from app
			audioStream.getAudioTracks().forEach(track => {
				combinedStream!.addTrack(track);
			});

			// Setup MediaRecorder
			const options: MediaRecorderOptions = {};
			if (MediaRecorder.isTypeSupported('video/webm;codecs=vp9')) {
				options.mimeType = 'video/webm;codecs=vp9';
			} else if (MediaRecorder.isTypeSupported('video/webm;codecs=vp8')) {
				options.mimeType = 'video/webm;codecs=vp8';
			} else if (MediaRecorder.isTypeSupported('video/webm')) {
				options.mimeType = 'video/webm';
			} else if (MediaRecorder.isTypeSupported('video/mp4')) {
				options.mimeType = 'video/mp4';
			}

			recordedChunks = [];
			startTime = Date.now();

			mediaRecorder = new MediaRecorder(combinedStream, options);
			mediaRecorder.ondataavailable = (event) => {
				if (event.data.size > 0) {
					recordedChunks.push(event.data);
				}
			};

			mediaRecorder.onerror = (event) => {
				console.error('Errore durante la registrazione video:', event);
			};

			// Handle screen sharing stop
			screenStream.getVideoTracks()[0].addEventListener('ended', () => {
				if (isActive && mediaRecorder && mediaRecorder.state !== 'inactive') {
					stop();
				}
			});

			mediaRecorder.start(100); // Collect data every 100ms
			isActive = true;
		} catch (error) {
			console.error('Errore avvio registrazione video:', error);
			isActive = false;
			// Cleanup on error
			if (screenStream) {
				screenStream.getTracks().forEach(track => track.stop());
				screenStream = null;
			}
			if (audioStream) {
				audioStream.getTracks().forEach(track => track.stop());
				audioStream = null;
			}
			throw error;
		}
	}

	async function stop(): Promise<Blob | null> {
		if (!isActive || !mediaRecorder) return null;

		return new Promise((resolve) => {
			mediaRecorder!.onstop = () => {
				if (recordedChunks.length === 0) {
					cleanup();
					resolve(null);
					return;
				}
				const blob = new Blob(recordedChunks, { 
					type: mediaRecorder?.mimeType || 'video/webm' 
				});
				cleanup();
				resolve(blob);
			};

			mediaRecorder.stop();
		});
	}

	function cleanup() {
		isActive = false;
		
		// Stop all tracks
		if (screenStream) {
			screenStream.getTracks().forEach(track => track.stop());
			screenStream = null;
		}
		if (audioStream) {
			audioStream.getTracks().forEach(track => track.stop());
			audioStream = null;
		}
		if (combinedStream) {
			combinedStream.getTracks().forEach(track => track.stop());
			combinedStream = null;
		}

		// Disconnect audio node
		if (audioNode) {
			audioNode.disconnect();
		}

		recordedChunks = [];
		mediaRecorder = null;
	}

	function isRecording(): boolean {
		return isActive && mediaRecorder?.state === 'recording';
	}

	function getDuration(): number {
		if (!isActive || startTime === 0) return 0;
		return (Date.now() - startTime) / 1000; // Return duration in seconds
	}

	return { start, stop, isRecording, getDuration };
}

