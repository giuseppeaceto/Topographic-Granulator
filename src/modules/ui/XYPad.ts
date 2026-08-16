export type XYPad = {
	setPosition: (x: number, y: number) => void; // 0..1
	setPositionSilent?: (x: number, y: number) => void; // 0..1, update visual but don't emit
	getPosition: () => { x: number; y: number };
	onChange: (cb: (pos: { x: number; y: number }) => void) => void;
	setCornerLabels: (labels: { tl?: string; tr?: string; bl?: string; br?: string }) => void;
	setSpeed?: (normal: number, shift: number) => void;
	setReverbMix?: (reverbMix: number) => void;
	setFilterCutoff?: (cutoffHz: number, cornerWeight: number) => void;
	setDensity?: (density: number, cornerWeight: number) => void;
	updateTheme?: () => void;
	setGhostPositions?: (positions: { x: number, y: number, colorIndex: number }[]) => void;
	onCornerClick?: (cb: (cornerKey: 'tl' | 'tr' | 'bl' | 'br', ev: PointerEvent) => void) => void;
};
