export type UndoSnapshot<T> = T;

export function createUndoStack<T>(limit = 40) {
	const undo: T[] = [];
	const redo: T[] = [];
	let applying = false;

	function push(snapshot: T) {
		if (applying) return;
		undo.push(snapshot);
		if (undo.length > limit) undo.shift();
		redo.length = 0;
	}

	function popUndo(current: T): T | null {
		if (undo.length === 0) return null;
		redo.push(current);
		return undo.pop() ?? null;
	}

	function popRedo(current: T): T | null {
		if (redo.length === 0) return null;
		undo.push(current);
		return redo.pop() ?? null;
	}

	function run(fn: () => void) {
		applying = true;
		try {
			fn();
		} finally {
			applying = false;
		}
	}

	function canUndo() {
		return undo.length > 0;
	}
	function canRedo() {
		return redo.length > 0;
	}

	return { push, popUndo, popRedo, run, canUndo, canRedo };
}
