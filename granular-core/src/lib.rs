use wasm_bindgen::prelude::*;

mod dsp;
use dsp::{BiquadFilter, DelayLine, Reverb};

// Simple Xorshift RNG
struct Rng {
    state: u32,
}

impl Rng {
    fn new(seed: u32) -> Self {
        Rng { state: seed.max(1) }
    }

    fn next_f32(&mut self) -> f32 {
        let mut x = self.state;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        self.state = x;
        (x as f32) / (u32::MAX as f32)
    }
}

// Struttura Grain interna con precisione f64 per evitare perdita di precisione su campioni grandi
#[derive(Clone, Copy)]
struct Grain {
    active: bool,
    start_sample: f64, 
    end_sample: f64,   
    length: f64,       
    age: f64,          
    rate: f64,         
    amp: f32,
    tight: bool,
}

impl Grain {
    fn empty() -> Self {
        Grain {
            active: false,
            start_sample: 0.0,
            end_sample: 0.0,
            length: 0.0,
            age: 0.0,
            rate: 1.0,
            amp: 1.0,
            tight: false,
        }
    }

    fn init(&mut self, start: f64, length: f64, rate: f64, tight: bool) {
        self.active = true;
        self.start_sample = start;
        self.end_sample = start + (length * rate);
        self.length = length;
        self.age = 0.0;
        self.rate = rate;
        self.amp = 1.0;
        self.tight = tight;
    }
}

// Helper per allocare memoria da JS
#[wasm_bindgen]
pub fn alloc(len: usize) -> *mut f32 {
    let mut buf = Vec::with_capacity(len);
    let ptr = buf.as_mut_ptr();
    std::mem::forget(buf); 
    ptr
}

const MAX_GRAINS: usize = 512;

#[wasm_bindgen]
pub struct GranularEngine {
    sample_rate: f32,
    audio_buffer: Vec<f32>,
    grains: [Grain; MAX_GRAINS],
    
    // Params
    grain_size_ms: f32,
    density: f32,
    random_start_ms: f32,
    pitch_semitones: f32,
    target_pitch_semitones: f64,
    current_pitch_semitones: f64,
    pitch_smooth_alpha: f64,
    
    // Effects
    filter: BiquadFilter,
    delay: DelayLine,
    reverb: Reverb,
    
    // Effect Params
    delay_mix: f32,
    delay_feedback: f32,
    delay_time_ms: f32,
    
    reverb_mix: f32,
    master_gain: f32,
    
    // State
    time_since_last_grain: f32,
    region_start: usize,
    region_end: usize,
    is_playing: bool,
    rng: Rng,
    grain_anchor_enabled: bool,
    grain_anchor_sample: f64,
    auto_spawn: bool,
}

#[wasm_bindgen]
impl GranularEngine {
    #[wasm_bindgen(constructor)]
    pub fn new(sample_rate: f32) -> GranularEngine {
        GranularEngine {
            sample_rate,
            audio_buffer: Vec::new(),
            grains: [Grain::empty(); MAX_GRAINS],
            
            grain_size_ms: 80.0,
            density: 15.0,
            random_start_ms: 40.0,
            pitch_semitones: 0.0,
            target_pitch_semitones: 0.0,
            current_pitch_semitones: 0.0,
            pitch_smooth_alpha: 1.0 - (-1.0 / (0.045 * sample_rate as f64)).exp(), // ~45ms portamento glide
            
            filter: BiquadFilter::new(sample_rate),
            delay: DelayLine::new(2000.0, sample_rate), // 2s max delay
            reverb: Reverb::new(sample_rate),
            
            delay_mix: 0.0,
            delay_feedback: 0.3,
            delay_time_ms: 250.0,
            
            reverb_mix: 0.0,
            master_gain: 1.0,
            
            time_since_last_grain: 0.0,
            region_start: 0,
            region_end: 0,
            is_playing: false,
            rng: Rng::new(12345),
            grain_anchor_enabled: false,
            grain_anchor_sample: 0.0,
            auto_spawn: true,
        }
    }
    
    // Metodi interni non esposti direttamente (usiamo i wrapper statici sotto)
    fn set_buffer_internal(&mut self, buffer_ptr: *const f32, len: usize) {
        let slice = unsafe { std::slice::from_raw_parts(buffer_ptr, len) };
        self.audio_buffer = slice.to_vec();
        self.region_start = 0;
        self.region_end = self.audio_buffer.len();
    }

    fn set_region_internal(&mut self, start: usize, end: usize) {
        let len = self.audio_buffer.len();
        if len == 0 { return; }
        self.region_start = start.min(len);
        self.region_end = end.min(len).max(self.region_start);
    }
    
    fn set_params_internal(&mut self, grain_size_ms: f32, density: f32, random_start_ms: f32, pitch_semitones: f32) {
        self.grain_size_ms = grain_size_ms;
        self.density = density;
        self.random_start_ms = random_start_ms;
        self.pitch_semitones = pitch_semitones;
        self.target_pitch_semitones = pitch_semitones as f64;
    }
    
    fn set_effect_params_internal(&mut self, cutoff: f32, q: f32, delay_time_ms: f32, delay_feedback: f32, delay_mix: f32, reverb_mix: f32, master_gain: f32) {
        self.filter.set_params(cutoff, q);
        self.delay_time_ms = delay_time_ms;
        self.delay_feedback = delay_feedback;
        self.delay_mix = delay_mix.clamp(0.0, 1.0);
        
        self.reverb_mix = reverb_mix.clamp(0.0, 1.0);
        self.reverb.set_params(self.reverb_mix, 0.5, 0.5); // Default room/damp
        
        self.master_gain = master_gain.max(0.0);
    }
    
    // Metodo unificato per aggiornare tutto lo stato (preset recall optimization)
    fn set_all_params_internal(&mut self, 
        grain_size_ms: f32, density: f32, random_start_ms: f32, pitch_semitones: f32,
        cutoff: f32, q: f32, delay_time_ms: f32, delay_feedback: f32, delay_mix: f32, reverb_mix: f32, master_gain: f32,
        region_start: usize, region_end: usize
    ) {
        // Granular
        self.grain_size_ms = grain_size_ms;
        self.density = density;
        self.random_start_ms = random_start_ms;
        self.pitch_semitones = pitch_semitones;
        self.target_pitch_semitones = pitch_semitones as f64;
        
        // FX
        self.filter.set_params(cutoff, q);
        self.delay_time_ms = delay_time_ms;
        self.delay_feedback = delay_feedback;
        self.delay_mix = delay_mix.clamp(0.0, 1.0);
        self.reverb_mix = reverb_mix.clamp(0.0, 1.0);
        self.reverb.set_params(self.reverb_mix, 0.5, 0.5);
        self.master_gain = master_gain.max(0.0);
        
        // Region
        let len = self.audio_buffer.len();
        if len > 0 {
            self.region_start = region_start.min(len);
            self.region_end = region_end.min(len).max(self.region_start);
        }
    }
    
    fn set_playing_internal(&mut self, playing: bool) {
        self.is_playing = playing;
        // Keeping ringing on stop is nicer
    }

    fn process_internal(&mut self, output_ptr: *mut f32, len: usize) {
        let output = unsafe { std::slice::from_raw_parts_mut(output_ptr, len) };
        
        let density = self.density.max(0.1);
        let interval_samples = self.sample_rate / density;
        
        let delay_mix = self.delay_mix;
        let delay_fb = self.delay_feedback;
        let delay_time = self.delay_time_ms;
        let master_gain = self.master_gain;
        let buf_len = self.audio_buffer.len();

        for i in 0..len {
            let mut current_sample = 0.0;
            
            // Smooth pitch per-sample (Pitch Glide / Portamento in 64-bit precision)
            self.current_pitch_semitones += (self.target_pitch_semitones - self.current_pitch_semitones) * self.pitch_smooth_alpha;
            let current_rate = 2.0f64.powf(self.current_pitch_semitones / 12.0);
            
            // 1. Granular Generation
            if buf_len > 0 && self.is_playing && self.auto_spawn {
                self.time_since_last_grain += 1.0;
                if self.time_since_last_grain >= interval_samples {
                    self.spawn_grain(false);
                    self.time_since_last_grain -= interval_samples;
                }
            }

            // 2. Process active grains in zero-allocation pool with 64-bit precision
            if buf_len > 0 {
                for g in self.grains.iter_mut() {
                    if !g.active {
                        continue;
                    }
                    
                    let env_pos = (g.age / g.length) as f32;
                    let attack = if g.tight {
                        (3.0 / g.length as f32).min(0.04)
                    } else {
                        0.2f32.min((10.0 / g.length) as f32)
                    };
                    let release = 0.25f32.min((12.0 / g.length) as f32);
                    
                    let amp = if env_pos < attack {
                        env_pos / attack.max(1e-6)
                    } else if env_pos > 1.0 - release {
                        (1.0 - env_pos) / release.max(1e-6)
                    } else {
                        1.0
                    };

                    let reg_start = self.region_start;
                    let reg_end = self.region_end.max(reg_start + 1);
                    let reg_len = reg_end - reg_start;

                    let raw_pos = g.start_sample.floor() as usize;
                    let rel_pos = if raw_pos >= reg_start { raw_pos - reg_start } else { 0 };
                    let clamped_pos = reg_start + (rel_pos % reg_len);
                    let next_pos = reg_start + ((rel_pos + 1) % reg_len);
                    let frac = (g.start_sample - g.start_sample.floor()) as f32;

                    let s = if clamped_pos < buf_len && next_pos < buf_len {
                        let s1 = self.audio_buffer[clamped_pos];
                        let s2 = self.audio_buffer[next_pos];
                        s1 + (s2 - s1) * frac
                    } else {
                        0.0
                    };
                    
                    current_sample += s * amp;

                    // Dynamically advance sample position using 64-bit float smoothed pitch rate
                    g.start_sample += current_rate;
                    g.age += 1.0;
                    if g.age >= g.length {
                        g.active = false;
                    }
                }
            }

            // 3. Filter (Post-granulator)
            let filtered = self.filter.process(current_sample);
            
            // 4. Delay
            let delayed_sig = self.delay.read(delay_time);
            let delay_in = filtered + (delayed_sig * delay_fb);
            self.delay.write(delay_in);
            
            let delay_out = filtered * (1.0 - delay_mix) + delayed_sig * delay_mix;
            
            // 5. Reverb
            let reverb_out = self.reverb.process(delay_out);
            
            // 6. Master Gain
            output[i] = reverb_out * master_gain;
        }
    }

    fn set_grain_anchor_internal(&mut self, sample: f64, enabled: bool) {
        self.grain_anchor_enabled = enabled;
        self.grain_anchor_sample = sample.max(0.0);
    }

    fn set_auto_spawn_internal(&mut self, enabled: bool) {
        self.auto_spawn = enabled;
    }

    fn spawn_now_internal(&mut self, count: u32) {
        let n = count.max(1).min(32);
        for _ in 0..n {
            self.spawn_grain(true);
        }
        self.time_since_last_grain = 0.0;
    }

    fn spawn_grain(&mut self, tight: bool) {
        let reg_start = self.region_start as f64;
        let reg_end = self.region_end as f64;
        let reg_len = (reg_end - reg_start).max(1.0);

        let origin = if self.grain_anchor_enabled {
            self.grain_anchor_sample
        } else {
            reg_start
        };

        let rand_val = self.rng.next_f32() as f64; 
        let max_rand_offset = ((self.random_start_ms / 1000.0) as f64 * (self.sample_rate as f64)).min(reg_len);
        let rand_offset = (rand_val * 2.0 - 1.0) * max_rand_offset;
        
        let mut start = origin + rand_offset;
        if start < reg_start { start = reg_start; }
        if start >= reg_end { start = (reg_end - 1.0).max(reg_start); }

        let length = ((self.grain_size_ms / 1000.0) as f64 * (self.sample_rate as f64)).max(1.0);
        let rate = 2.0f64.powf(self.current_pitch_semitones / 12.0);

        // Find first inactive slot in pool
        for g in self.grains.iter_mut() {
            if !g.active {
                g.init(start, length, rate, tight);
                break;
            }
        }
    }
}

// --- FUNZIONI STATICHE WRAPPER (Per export sicuro) ---

#[wasm_bindgen]
pub fn granularengine_set_buffer(engine: &mut GranularEngine, ptr: *const f32, len: usize) {
    engine.set_buffer_internal(ptr, len);
}

#[wasm_bindgen]
pub fn granularengine_set_region(engine: &mut GranularEngine, start: usize, end: usize) {
    engine.set_region_internal(start, end);
}

#[wasm_bindgen]
pub fn granularengine_set_params(engine: &mut GranularEngine, grain_size_ms: f32, density: f32, random_start_ms: f32, pitch_semitones: f32) {
    engine.set_params_internal(grain_size_ms, density, random_start_ms, pitch_semitones);
}

#[wasm_bindgen]
pub fn granularengine_set_effect_params(
    engine: &mut GranularEngine, 
    cutoff: f32, 
    q: f32, 
    delay_time_ms: f32, 
    delay_feedback: f32, 
    delay_mix: f32,
    reverb_mix: f32,
    master_gain: f32
) {
    engine.set_effect_params_internal(cutoff, q, delay_time_ms, delay_feedback, delay_mix, reverb_mix, master_gain);
}

#[wasm_bindgen]
pub fn granularengine_set_all_params(
    engine: &mut GranularEngine,
    grain_size_ms: f32, density: f32, random_start_ms: f32, pitch_semitones: f32,
    cutoff: f32, q: f32, delay_time_ms: f32, delay_feedback: f32, delay_mix: f32, reverb_mix: f32, master_gain: f32,
    region_start: usize, region_end: usize
) {
    engine.set_all_params_internal(
        grain_size_ms, density, random_start_ms, pitch_semitones,
        cutoff, q, delay_time_ms, delay_feedback, delay_mix, reverb_mix, master_gain,
        region_start, region_end
    );
}

#[wasm_bindgen]
pub fn granularengine_set_playing(engine: &mut GranularEngine, playing: bool) {
    engine.set_playing_internal(playing);
}

#[wasm_bindgen]
pub fn granularengine_set_grain_anchor(engine: &mut GranularEngine, sample: f64, enabled: bool) {
    engine.set_grain_anchor_internal(sample, enabled);
}

#[wasm_bindgen]
pub fn granularengine_set_auto_spawn(engine: &mut GranularEngine, enabled: bool) {
    engine.set_auto_spawn_internal(enabled);
}

#[wasm_bindgen]
pub fn granularengine_spawn_now(engine: &mut GranularEngine, count: u32) {
    engine.spawn_now_internal(count);
}

#[wasm_bindgen]
pub fn granularengine_process(engine: &mut GranularEngine, output_ptr: *mut f32, len: usize) {
    engine.process_internal(output_ptr, len);
}
