export type Region = { start: number; end: number; name?: string };

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
	return { get, set, getAll };
}


