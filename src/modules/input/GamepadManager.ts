import { logger } from '../utils/logger';

const DEAD_ZONE = 0.12;

export type GamepadManagerConfig = {
	getSpeed: () => { normal: number; shift: number };
	getPosition: () => { x: number; y: number };
	onMove: (pos: { x: number; y: number }) => void;
	onActiveChange: (active: boolean) => void;
	isEnabled?: () => boolean;
};

function applyDeadZone(v: number, deadZone: number): number {
	const abs = Math.abs(v);
	if (abs < deadZone) return 0;
	const sign = v < 0 ? -1 : 1;
	return sign * ((abs - deadZone) / (1 - deadZone));
}

function getFirstGamepad(): Gamepad | null {
	const pads = navigator.getGamepads?.();
	if (!pads) return null;
	for (const gp of pads) {
		if (gp?.connected) return gp;
	}
	return null;
}

function hasConnectedGamepad(): boolean {
	return getFirstGamepad() != null;
}

/** Standard Xbox mapping: left stick axes 0/1, LB = button 4. */
export function createGamepadManager(config: GamepadManagerConfig) {
	let animId: number | null = null;
	let lastTs = 0;
	let wasActive = false;

	function loop(ts: number) {
		animId = null;
		const dt = Math.max(0, Math.min(0.05, (ts - lastTs) / 1000));
		lastTs = ts;

		const enabled = config.isEnabled?.() ?? true;
		const gp = enabled ? getFirstGamepad() : null;

		if (!gp) {
			if (wasActive) {
				wasActive = false;
				config.onActiveChange(false);
			}
			if (hasConnectedGamepad()) ensureLoop();
			return;
		}

		const ax = applyDeadZone(gp.axes[0] ?? 0, DEAD_ZONE);
		const ay = applyDeadZone(gp.axes[1] ?? 0, DEAD_ZONE);
		const slowMode = !!(gp.buttons[4]?.pressed);
		const { normal, shift } = config.getSpeed();
		const speed = slowMode ? shift : normal;
		const active = ax !== 0 || ay !== 0;

		if (active) {
			const pos = config.getPosition();
			config.onMove({
				x: pos.x + ax * speed * dt,
				y: pos.y + ay * speed * dt,
			});
		}

		if (active !== wasActive) {
			wasActive = active;
			config.onActiveChange(active);
		}

		ensureLoop();
	}

	function ensureLoop() {
		if (animId != null) return;
		lastTs = performance.now();
		animId = requestAnimationFrame(loop);
	}

	function stopLoop() {
		if (animId != null) {
			cancelAnimationFrame(animId);
			animId = null;
		}
	}

	function onConnect(ev: GamepadEvent) {
		logger.log('Gamepad connected:', ev.gamepad.id);
		ensureLoop();
	}

	function onDisconnect(ev: GamepadEvent) {
		logger.log('Gamepad disconnected:', ev.gamepad.id);
		if (wasActive) {
			wasActive = false;
			config.onActiveChange(false);
		}
		if (!hasConnectedGamepad()) stopLoop();
	}

	window.addEventListener('gamepadconnected', onConnect);
	window.addEventListener('gamepaddisconnected', onDisconnect);

	if (hasConnectedGamepad()) ensureLoop();

	return {
		destroy() {
			stopLoop();
			window.removeEventListener('gamepadconnected', onConnect);
			window.removeEventListener('gamepaddisconnected', onDisconnect);
			if (wasActive) {
				wasActive = false;
				config.onActiveChange(false);
			}
		},
	};
}
