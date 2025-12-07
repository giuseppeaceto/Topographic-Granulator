export type Region = { start: number; end: number; name?: string; iconIndex?: number };

export function createRegionStore(size: number) {
	const pads: Array<Region | null> = new Array(size).fill(null);

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
	return { get, set, getAll, add };
}


