import type { GranularParams } from '../granular/GranularWorkletEngine';
import type { EffectsParams } from '../effects/EffectsChain';
import { PARAMS, type ParamId } from '../ui/ParamRegistry';

export type InterpolationWeights = {
    tl: number;
    tr: number;
    bl: number;
    br: number;
};

export type CornerMapping = {
    tl: string;
    tr: string;
    bl: string;
    br: string;
};

export type BaseParams = {
    granular: GranularParams;
    effects: EffectsParams;
    selectionPos?: number; // Optional, handled separately usually
};

export type MappingResult = {
    granular: Partial<GranularParams>;
    effects: Partial<EffectsParams>;
};

export class ParameterMapper {
    
    // Calculate bilinear interpolation weights from normalized XY (0..1)
    static calculateWeights(x: number, y: number): InterpolationWeights {
        return {
            tl: (1 - x) * (1 - y),
            tr: x * (1 - y),
            bl: (1 - x) * y,
            br: x * y
        };
    }

    // Calculate resulting parameters based on weights, base params, and corner mapping
    static mapParams(
        weights: InterpolationWeights,
        baseParams: BaseParams,
        mapping: CornerMapping
    ): MappingResult {
        const influenceMap = new Map<ParamId, number>();
        
        const addInfluence = (idStr: string, w: number) => {
            if (!idStr) return;
            if (idStr.startsWith('pad:')) return; // Skip pad morphing
            const id = idStr as ParamId;
            influenceMap.set(id, (influenceMap.get(id) || 0) + w);
        };

        addInfluence(mapping.tl, weights.tl);
        addInfluence(mapping.tr, weights.tr);
        addInfluence(mapping.bl, weights.bl);
        addInfluence(mapping.br, weights.br);

        const granularUpdate: Partial<GranularParams> = {};
        const fxUpdate: Partial<EffectsParams> = {};

        for (const [paramId, infl] of influenceMap.entries()) {
            const meta = PARAMS.find(p => p.id === paramId);
            if (!meta) continue;

            // Determine base value
            let baseVal = 0;
            if (meta.kind === 'granular') {
                baseVal = (baseParams.granular as any)[meta.id] as number;
            } else if (meta.kind === 'fx') {
                baseVal = (baseParams.effects as any)[meta.id] as number;
            } else if (meta.kind === 'selection') {
                baseVal = baseParams.selectionPos ?? 0;
            }

            // Interpolate towards MAX based on influence
            const targetVal = meta.max;
            // Clamp influence to 0..1 just in case
            const safeInfl = Math.max(0, Math.min(1, infl));
            const newVal = baseVal + (targetVal - baseVal) * safeInfl;

            if (meta.kind === 'granular') {
                (granularUpdate as any)[meta.id] = newVal;
            } else if (meta.kind === 'fx') {
                (fxUpdate as any)[meta.id] = newVal;
            }
            // Selection position update logic is typically handled outside due to buffer dependency
        }

        return { granular: granularUpdate, effects: fxUpdate };
    }
}

