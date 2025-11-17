class Grain {
  constructor(startSample, lengthSamples, rate, sampleRate, numChannels) {
    this.pos = startSample;
    this.end = startSample + lengthSamples;
    this.rate = rate;
    this.sampleRate = sampleRate;
    this.numChannels = numChannels;
    this.age = 0;
    this.length = lengthSamples;
  }
}

// Simple linear interpolator
function lerp(a, b, t) { return a + (b - a) * t; }

class GranularProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.sampleRate_ = sampleRate;
    this.buffer = null; // {channels: [Float32Array], length, numChannels}
    this.regionStart = 0;
    this.regionEnd = 0;
    this.params = {
      grainSizeMs: 80,
      density: 15,
      randomStartMs: 40,
      pitchSemitones: 0
    };
    this.running = false;
    this.timeSinceLastGrain = 0;
    this.activeGrains = [];

    this.port.onmessage = (e) => {
      const msg = e.data;
      if (msg?.type === 'setBuffer') {
        this.buffer = {
          channels: msg.channels,
          length: msg.channels[0]?.length || 0,
          numChannels: msg.channels.length
        };
      } else if (msg?.type === 'setRegion') {
        this.regionStart = Math.max(0, msg.startSample|0);
        this.regionEnd = Math.max(this.regionStart, msg.endSample|0);
      } else if (msg?.type === 'setParams') {
        Object.assign(this.params, msg.params || {});
      } else if (msg?.type === 'trigger') {
        this.running = !!msg.on;
      }
    };
  }

  spawnGrain() {
    if (!this.buffer) return;
    const regionLen = Math.max(1, this.regionEnd - this.regionStart);
    const rand = (Math.random() * 2 - 1) * (this.params.randomStartMs / 1000) * this.sampleRate_;
    let start = this.regionStart + rand;
    if (start < this.regionStart) start = this.regionStart;
    if (start > this.regionEnd - 1) start = Math.max(this.regionStart, this.regionEnd - 1);
    const length = Math.max(1, Math.floor((this.params.grainSizeMs / 1000) * this.sampleRate_));
    const rate = Math.pow(2, this.params.pitchSemitones / 12);
    const g = new Grain(start, length, rate, this.sampleRate_, this.buffer.numChannels);
    this.activeGrains.push(g);
  }

  process(inputs, outputs) {
    const output = outputs[0];
    const numChannels = output.length;
    const frames = output[0].length;

    for (let ch = 0; ch < numChannels; ch++) {
      const out = output[ch];
      out.fill(0);
    }

    if (!this.buffer || !this.running) {
      return true;
    }

    const intervalFrames = Math.max(1, Math.floor(this.sampleRate_ / Math.max(1, this.params.density)));

    for (let i = 0; i < frames; i++) {
      // spawn grains at density
      if (this.timeSinceLastGrain >= intervalFrames) {
        this.timeSinceLastGrain = 0;
        this.spawnGrain();
      }
      this.timeSinceLastGrain++;

      // mix active grains
      for (let gi = this.activeGrains.length - 1; gi >= 0; gi--) {
        const g = this.activeGrains[gi];
        const envPos = g.age / g.length;
        const attack = Math.min(0.2, 10 / g.length); // normalized small attack
        const release = Math.min(0.25, 12 / g.length);
        let amp = 1.0;
        if (envPos < attack) amp = envPos / Math.max(1e-6, attack);
        else if (envPos > 1.0 - release) amp = (1.0 - envPos) / Math.max(1e-6, release);
        if (amp < 0) amp = 0;

        const p = g.pos;
        const pInt = Math.floor(p);
        const frac = p - pInt;
        if (pInt < this.regionStart || pInt + 1 >= this.regionEnd) {
          this.activeGrains.splice(gi, 1);
          continue;
        }
        for (let ch = 0; ch < numChannels; ch++) {
          const srcCh = this.buffer.channels[Math.min(ch, this.buffer.numChannels - 1)];
          const a = srcCh[pInt] || 0;
          const b = srcCh[pInt + 1] || 0;
          const s = lerp(a, b, frac) * amp;
          output[ch][i] += s;
        }
        g.pos += g.rate;
        g.age++;
        if (g.age >= g.length) {
          this.activeGrains.splice(gi, 1);
        }
      }
    }

    return true;
  }
}

registerProcessor('granular-processor', GranularProcessor);


