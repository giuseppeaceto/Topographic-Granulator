/**
 * ScaleQuantizer — Musical Scale Quantization for Pitch Control
 *
 * Provides scale definitions and a quantization function that snaps
 * a pitch value (in semitones) to the nearest note in the active scale.
 * The scale is always relative to pitch 0 (the original sample pitch).
 */

export type ScaleDef = {
    /** Display name shown in UI */
    name: string;
    /** Short abbreviation shown in the compact selector */
    abbr: string;
    /** Interval set within one octave (0–11), always includes 0 */
    intervals: number[];
};

export const SCALES: ScaleDef[] = [
    { name: 'Chromatic',       abbr: 'CHROM',   intervals: [0,1,2,3,4,5,6,7,8,9,10,11] },
    { name: 'Major',           abbr: 'MAJOR',   intervals: [0,2,4,5,7,9,11] },
    { name: 'Natural Minor',   abbr: 'N.MIN',   intervals: [0,2,3,5,7,8,10] },
    { name: 'Harmonic Minor',  abbr: 'H.MIN',   intervals: [0,2,3,5,7,8,11] },
    { name: 'Pentatonic Maj',  abbr: 'PENT+',   intervals: [0,2,4,7,9] },
    { name: 'Pentatonic Min',  abbr: 'PENT-',   intervals: [0,3,5,7,10] },
    { name: 'Blues',           abbr: 'BLUES',   intervals: [0,3,5,6,7,10] },
    { name: 'Dorian',          abbr: 'DORI',    intervals: [0,2,3,5,7,9,10] },
    { name: 'Phrygian',        abbr: 'PHRYG',   intervals: [0,1,3,5,7,8,10] },
    { name: 'Lydian',          abbr: 'LYDI',    intervals: [0,2,4,6,7,9,11] },
    { name: 'Mixolydian',      abbr: 'MIXO',    intervals: [0,2,4,5,7,9,10] },
    { name: 'Whole Tone',      abbr: 'WHOLE',   intervals: [0,2,4,6,8,10] },
    { name: 'Diminished',      abbr: 'DIM',     intervals: [0,2,3,5,6,8,9,11] },
];

/**
 * Quantize a semitone value to the nearest note in the given scale.
 *
 * Works across the full -12..+12 range by expanding the scale intervals
 * across all octaves within that range, then finding the closest one.
 *
 * @param semitones - Input pitch value (float, clamped to -12..+12)
 * @param scaleIndex - Index into SCALES array (0 = Chromatic, i.e. no-op)
 * @returns Nearest semitone value belonging to the scale (integer)
 */
export function quantizePitch(semitones: number, scaleIndex: number): number {
    const scale = SCALES[scaleIndex];
    if (!scale) return Math.round(semitones);

    // Chromatic = no quantization needed, return rounded value
    if (scale.intervals.length === 12) return Math.round(semitones);

    const { intervals } = scale;
    const MIN_PITCH = -12;
    const MAX_PITCH = 12;

    // Build a sorted list of all valid scale pitches across -12..+12
    const validPitches: number[] = [];
    for (let octave = -2; octave <= 2; octave++) {
        for (const interval of intervals) {
            const pitch = octave * 12 + interval;
            if (pitch >= MIN_PITCH && pitch <= MAX_PITCH) {
                validPitches.push(pitch);
            }
        }
    }
    validPitches.sort((a, b) => a - b);

    if (validPitches.length === 0) return Math.round(semitones);

    // Find closest pitch using binary search approach
    let closest = validPitches[0];
    let minDist = Math.abs(semitones - closest);
    for (const p of validPitches) {
        const dist = Math.abs(semitones - p);
        if (dist < minDist) {
            minDist = dist;
            closest = p;
        }
    }

    return closest;
}
