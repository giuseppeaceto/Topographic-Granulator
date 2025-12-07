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
    this.useWasm = false;

    this.port.onmessage = async (e) => {
      const msg = e.data;
      if (msg?.type === 'loadWasm') {
        try {
          const module = await WebAssembly.compile(msg.wasmBytes);
          
          // Proxy per soddisfare import di wasm-bindgen (anche se ora non ne usiamo)
          const importProxy = new Proxy({}, {
            get(target, prop) {
              return (...args) => 0; // Dummy function
            }
          });

          const imports = {
            env: importProxy,
            wbg: importProxy,
            './granular_core_bg.js': importProxy
          };

          this.wasmInstance = await WebAssembly.instantiate(module, imports);
          this.wasmMemory = this.wasmInstance.exports.memory;
          
          const exports = this.wasmInstance.exports;
          
          if (exports.granularengine_new) {
              this.wasmEnginePtr = exports.granularengine_new(this.sampleRate_);
              // console.log('[GranularProcessor] Rust Engine created');
              
              if (this.pendingBuffer) {
                  this.sendBufferToWasm(this.pendingBuffer);
                  this.pendingBuffer = null;
              }
              
              this.useWasm = true; 
          }

        } catch (err) {
          console.error('[GranularProcessor] Failed to load WASM:', err);
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
      }
    };
  }

  sendBufferToWasm(float32Array) {
      if (!this.wasmInstance || !this.wasmEnginePtr) return;
      
      const exports = this.wasmInstance.exports;
      const len = float32Array.length;
      
      const ptr = exports.alloc(len);
      
      const wasmHeap = new Float32Array(this.wasmMemory.buffer);
      const offset = ptr / 4; 
      wasmHeap.set(float32Array, offset);
      
      exports.granularengine_set_buffer(this.wasmEnginePtr, ptr, len);
  }

  process(inputs, outputs) {
    const output = outputs[0];
    const numChannels = output.length; 
    const frames = output[0].length;   

    // Silence output initially
    for (let ch = 0; ch < numChannels; ch++) {
      output[ch].fill(0);
    }

    if (this.useWasm && this.wasmEnginePtr && this.wasmInstance) {
        const exports = this.wasmInstance.exports;
        
        // Lazy alloc output buffer
        if (!this.wasmOutputPtr || this.wasmOutputLen !== frames) {
            this.wasmOutputPtr = exports.alloc(frames);
            this.wasmOutputLen = frames;
        }
        
        // Process in Rust (Mono)
        exports.granularengine_process(this.wasmEnginePtr, this.wasmOutputPtr, frames);
        
        // Copy back to JS
        // Re-create view every frame (heap buffer might change)
        const wasmHeap = new Float32Array(this.wasmMemory.buffer);
        const offset = this.wasmOutputPtr / 4;
        const result = wasmHeap.subarray(offset, offset + frames);
        
        // Copy Mono result to all output channels
        for (let ch = 0; ch < numChannels; ch++) {
            output[ch].set(result);
        }
        
        return true;
    }

    // Fallback silence if WASM not ready
    return true;
  }
}

registerProcessor('granular-processor', GranularProcessor);
