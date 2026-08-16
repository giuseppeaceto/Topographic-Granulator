// WASM-only Audio Processor for Undergrain
class GranularProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.sampleRate_ = sampleRate;
    
    // JS buffer cache (just for initial load before WASM is ready)
    this.pendingBuffer = null;
    this.regionStart = 0;
    this.regionEnd = 0;
    this.running = false;
    
    this.params = {
      grainSizeMs: 80,
      density: 15,
      randomStartMs: 40,
      pitchSemitones: 0
    };

    // WASM State
    this.wasmInstance = null;
    this.wasmEnginePtr = null; 
    this.wasmMemory = null;
    this.wasmOutputPtr = null; 
    this.wasmOutputLen = 0;
    this.heapF32 = null;
    this.heapBuffer = null;
    this.useWasm = false;
    this.wasmExports = null;

    this.port.onmessage = async (e) => {
      const msg = e.data;
      if (msg?.type === 'loadWasm') {
        try {
          let module = (msg.wasmModule instanceof WebAssembly.Module) ? msg.wasmModule : null;
          if (!module) {
            const bytes = msg.wasmBytes;
            if (!bytes) {
              throw new Error('Missing wasmModule / wasmBytes');
            }
            module = await WebAssembly.compile(bytes);
          }

          const self = this;
          const wbg = {
            __wbindgen_init_externref_table: () => {
              const table = self.wasmExports && self.wasmExports.__wbindgen_externrefs;
              if (!table) return;
              const offset = table.grow(4);
              table.set(0, undefined);
              table.set(offset + 0, undefined);
              table.set(offset + 1, null);
              table.set(offset + 2, true);
              table.set(offset + 3, false);
            },
            __wbg___wbindgen_throw_dd24417ed36fc46e: () => {
              throw new Error('granular wasm panic');
            }
          };
          const importProxy = new Proxy(wbg, {
            get(target, prop) {
              if (prop in target) return target[prop];
              return () => 0;
            }
          });

          const imports = {
            env: importProxy,
            wbg: importProxy,
            './granular_core_bg.js': importProxy
          };

          const instance = await WebAssembly.instantiate(module, imports);
          this.wasmInstance = instance;
          this.wasmExports = instance.exports;
          this.wasmMemory = instance.exports.memory;

          try {
            if (typeof instance.exports.__wbindgen_start === 'function') {
              instance.exports.__wbindgen_start();
            }
          } catch (startErr) {
            console.warn('[GranularProcessor] wbindgen start skipped:', startErr);
          }

          const exports = instance.exports;
          if (exports.granularengine_new) {
              this.wasmEnginePtr = exports.granularengine_new(this.sampleRate_);

              if (this.pendingBuffer) {
                  this.sendBufferToWasm(this.pendingBuffer);
                  this.pendingBuffer = null;
              }
              if (this.regionEnd > this.regionStart) {
                  exports.granularengine_set_region(this.wasmEnginePtr, this.regionStart, this.regionEnd);
              }
              exports.granularengine_set_params(
                  this.wasmEnginePtr,
                  this.params.grainSizeMs,
                  this.params.density,
                  this.params.randomStartMs,
                  this.params.pitchSemitones
              );
              if (this.running) {
                  exports.granularengine_set_playing(this.wasmEnginePtr, 1);
              }

              this.useWasm = true;
              this.port.postMessage({ type: 'wasmReady' });
          } else {
              throw new Error('granularengine_new export missing');
          }

        } catch (err) {
          this.useWasm = false;
          console.error('[GranularProcessor] Failed to load WASM:', err);
          this.port.postMessage({ type: 'wasmError', error: String(err && err.message ? err.message : err) });
        }
      } else if (msg?.type === 'setBuffer') {
        // Se WASM c'è, invia subito. Altrimenti salva per dopo.
        const ch0 = msg.channels[0];
        if (this.useWasm && this.wasmInstance) {
             this.sendBufferToWasm(ch0);
        } else {
             this.pendingBuffer = ch0;
        }

      } else if (msg?.type === 'setRegion') {
        this.regionStart = Math.max(0, msg.startSample|0);
        this.regionEnd = Math.max(this.regionStart, msg.endSample|0);
        
        if (this.useWasm && this.wasmEnginePtr) {
            this.wasmInstance.exports.granularengine_set_region(this.wasmEnginePtr, this.regionStart, this.regionEnd);
        }

      } else if (msg?.type === 'setParams') {
        Object.assign(this.params, msg.params || {});
        
        if (this.useWasm && this.wasmEnginePtr) {
            this.wasmInstance.exports.granularengine_set_params(
                this.wasmEnginePtr, 
                this.params.grainSizeMs,
                this.params.density,
                this.params.randomStartMs,
                this.params.pitchSemitones
            );
        }

      } else if (msg?.type === 'setEffectParams') {
        const p = msg.params;
        if (this.useWasm && this.wasmEnginePtr) {
             // Default values if missing handled by caller or here? 
             // Caller should provide values.
             // Updated signature: engine, cutoff, q, delay_time_ms, delay_feedback, delay_mix, reverb_mix, master_gain
             this.wasmInstance.exports.granularengine_set_effect_params(
                this.wasmEnginePtr,
                p.filterCutoffHz ?? 20000,
                p.filterQ ?? 0.7,
                p.delayTimeMs ?? 0,
                p.delayFeedback ?? 0,
                p.delayMix ?? 0,
                p.reverbMix ?? 0,
                p.masterGain ?? 1.0
             );
        }

      } else if (msg?.type === 'setAllParams') {
        const d = msg.data;
        // Update internal JS state
        Object.assign(this.params, {
            grainSizeMs: d.grainSizeMs,
            density: d.density,
            randomStartMs: d.randomStartMs,
            pitchSemitones: d.pitchSemitones
        });
        this.regionStart = Math.max(0, d.startSample|0);
        this.regionEnd = Math.max(this.regionStart, d.endSample|0);
        
        if (this.useWasm && this.wasmEnginePtr) {
            this.wasmInstance.exports.granularengine_set_all_params(
                this.wasmEnginePtr,
                d.grainSizeMs, d.density, d.randomStartMs, d.pitchSemitones,
                d.filterCutoffHz, d.filterQ, d.delayTimeMs, d.delayFeedback, d.delayMix, d.reverbMix, d.masterGain,
                this.regionStart, this.regionEnd
            );
        }

      } else if (msg?.type === 'trigger') {
        this.running = !!msg.on;
        if (this.useWasm && this.wasmEnginePtr) {
            this.wasmInstance.exports.granularengine_set_playing(this.wasmEnginePtr, this.running);
        }
      } else if (msg?.type === 'setGrainAnchor') {
        if (this.useWasm && this.wasmEnginePtr) {
            this.wasmInstance.exports.granularengine_set_grain_anchor(
                this.wasmEnginePtr,
                msg.sample ?? 0,
                !!msg.enabled
            );
        }
      } else if (msg?.type === 'setAutoSpawn') {
        if (this.useWasm && this.wasmEnginePtr) {
            this.wasmInstance.exports.granularengine_set_auto_spawn(this.wasmEnginePtr, !!msg.enabled);
        }
      } else if (msg?.type === 'spawnNow') {
        if (this.useWasm && this.wasmEnginePtr) {
            this.wasmInstance.exports.granularengine_spawn_now(this.wasmEnginePtr, (msg.count|0) || 1);
        }
      }
    };
  }

  heapView() {
      const buf = this.wasmMemory.buffer;
      if (this.heapF32 == null || this.heapBuffer !== buf) {
          this.heapBuffer = buf;
          this.heapF32 = new Float32Array(buf);
      }
      return this.heapF32;
  }

  sendBufferToWasm(float32Array) {
      if (!this.wasmInstance || !this.wasmEnginePtr) return;
      
      const exports = this.wasmInstance.exports;
      const len = float32Array.length;
      
      const ptr = exports.alloc(len);
      this.heapF32 = null;
      this.heapView().set(float32Array, ptr / 4);
      exports.granularengine_set_buffer(this.wasmEnginePtr, ptr, len);
      this.heapF32 = null;
  }

  process(inputs, outputs) {
    const output = outputs[0];
    const numChannels = output.length; 
    const frames = output[0].length;   

    if (this.useWasm && this.wasmEnginePtr && this.wasmInstance) {
        const exports = this.wasmInstance.exports;
        
        if (!this.wasmOutputPtr || this.wasmOutputLen !== frames) {
            this.wasmOutputPtr = exports.alloc(frames);
            this.wasmOutputLen = frames;
            this.heapF32 = null;
        }
        
        exports.granularengine_process(this.wasmEnginePtr, this.wasmOutputPtr, frames);
        
        const wasmHeap = this.heapView();
        const result = wasmHeap.subarray(this.wasmOutputPtr / 4, this.wasmOutputPtr / 4 + frames);
        output[0].set(result);
        for (let ch = 1; ch < numChannels; ch++) {
            output[ch].set(output[0]);
        }
        
        return true;
    }

    for (let ch = 0; ch < numChannels; ch++) {
      output[ch].fill(0);
    }
    return true;
  }
}

registerProcessor('granular-processor', GranularProcessor);
