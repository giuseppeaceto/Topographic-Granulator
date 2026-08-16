export type Region = { start: number; end: number; name?: string; iconIndex?: number };

export function createRegionStore(initialSize: number) {
	const pads: Array<Region | null> = new Array(initialSize).fill(null);

	function get(index: number): Region | null {
		return pads[index] ?? null;
	}
	function set(index: number, region: Region) {
		pads[index] = region;
	}
	function getAll(): Array<Region | null> {
		return pads.slice();
	}
	function add() {
		pads.push(null);
	}
	function remove(index: number) {
		pads.splice(index, 1);
	}
	function size() {
		return pads.length;
	}
	function replaceAll(next: Array<Region | null>) {
		pads.length = 0;
		for (const r of next) {
			pads.push(r ? { ...r } : null);
		}
	}
	return { get, set, getAll, add, remove, size, replaceAll };
}


