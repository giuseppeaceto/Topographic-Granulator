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

// Struttura Grain interna
struct Grain {
    start_sample: f32, 
    end_sample: f32,   
    length: f32,       
    age: f32,          
    rate: f32,         
    amp: f32,          
}

impl Grain {
    fn new(start: f32, length: f32, rate: f32) -> Self {
        Grain {
            start_sample: start,
            end_sample: start + (length * rate), 
            length,
            age: 0.0,
            rate,
            amp: 1.0,
        }
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

#[wasm_bindgen]
pub struct GranularEngine {
    sample_rate: f32,
    audio_buffer: Vec<f32>,
    grains: Vec<Grain>,
    
    // Params
    grain_size_ms: f32,
    density: f32,
    random_start_ms: f32,
    pitch_semitones: f32,
    
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
}

#[wasm_bindgen]
impl GranularEngine {
    #[wasm_bindgen(constructor)]
    pub fn new(sample_rate: f32) -> GranularEngine {
        GranularEngine {
            sample_rate,
            audio_buffer: Vec::new(),
            grains: Vec::with_capacity(1000),
            
            grain_size_ms: 80.0,
            density: 15.0,
            random_start_ms: 40.0,
            pitch_semitones: 0.0,
            
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
    
    fn set_playing_internal(&mut self, playing: bool) {
        self.is_playing = playing;
        // Reset effects state on stop? Or keep ringing? 
        // Keeping ringing is usually nicer.
    }

    fn process_internal(&mut self, output_ptr: *mut f32, len: usize) {
        let output = unsafe { std::slice::from_raw_parts_mut(output_ptr, len) };
        
        let density = self.density.max(0.1);
        let interval_samples = self.sample_rate / density;
        
        // Pre-fetch constants to avoid struct lookup in tight loop
        let delay_mix = self.delay_mix;
        let delay_fb = self.delay_feedback;
        let delay_time = self.delay_time_ms;
        let master_gain = self.master_gain;

        // Se non sta suonando e il buffer non è vuoto, output silenzio (o coda riverbero?)
        // Per ora: se non playing, il loop sotto non genera grani, ma il delay/reverb tail continua?
        // La logica attuale:
        // if !playing:
        //    if empty buffer -> loop skip -> output zero (initialized to 0 in JS?)
        //    Wait, JS initializes output to 0.
        //    Here we overwrite output[i] with calculated sample.
        
        // Se is_playing == false, spawn_grain non parte.
        // Ma delay/reverb devono processare "silenzio" in ingresso per far suonare la coda.
        // Quindi OK iterare anche se !is_playing, basta che current_sample resti 0.
        
        for i in 0..len {
            let mut current_sample = 0.0;
            
            // 1. Granular Generation
            if !self.audio_buffer.is_empty() && self.is_playing {
                self.time_since_last_grain += 1.0;
                if self.time_since_last_grain >= interval_samples {
                    self.spawn_grain();
                    self.time_since_last_grain -= interval_samples;
                }
            }

            // Process active grains (sempre, anche se playing stoppato, per far finire i grani correnti)
            if !self.grains.is_empty() {
                let mut j = 0;
                while j < self.grains.len() {
                    let remove = {
                        let g = &mut self.grains[j];
                        
                        let env_pos = g.age / g.length;
                        // Simple trapezoidal window
                        let attack = 0.2f32.min(10.0 / g.length);
                        let release = 0.25f32.min(12.0 / g.length);
                        
                        let mut amp = 0.0;
                        if env_pos < attack {
                            amp = env_pos / attack.max(1e-6);
                        } else if env_pos > 1.0 - release {
                            amp = (1.0 - env_pos) / release.max(1e-6);
                        } else {
                            amp = 1.0;
                        }

                        let pos_int = g.start_sample as usize;
                        let frac = g.start_sample - pos_int as f32;

                        let s = if pos_int < self.audio_buffer.len() - 1 {
                            let s1 = self.audio_buffer[pos_int];
                            let s2 = self.audio_buffer[pos_int + 1];
                            s1 + (s2 - s1) * frac
                        } else {
                            0.0
                        };
                        
                        current_sample += s * amp;

                        g.start_sample += g.rate;
                        g.age += 1.0;
                        g.age >= g.length
                    };

                    if remove {
                        self.grains.swap_remove(j);
                    } else {
                        j += 1;
                    }
                }
            }

            // 2. Filter (Post-granulator)
            let filtered = self.filter.process(current_sample);
            
            // 3. Delay
            let delayed_sig = self.delay.read(delay_time);
            let delay_in = filtered + (delayed_sig * delay_fb);
            self.delay.write(delay_in);
            
            let delay_out = filtered * (1.0 - delay_mix) + delayed_sig * delay_mix;
            
            // 4. Reverb
            let reverb_out = self.reverb.process(delay_out);
            
            // 5. Master Gain
            output[i] = reverb_out * master_gain;
        }
    }

    fn spawn_grain(&mut self) {
        let rand_val = self.rng.next_f32(); 
        let rand_offset = (rand_val * 2.0 - 1.0) * (self.random_start_ms / 1000.0) * self.sample_rate;
        
        let mut start = self.region_start as f32 + rand_offset;
        start = start.max(self.region_start as f32).min((self.region_end - 1) as f32);

        let length = (self.grain_size_ms / 1000.0 * self.sample_rate).max(1.0);
        let rate = 2.0f32.powf(self.pitch_semitones / 12.0);

        self.grains.push(Grain::new(start, length, rate));
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
pub fn granularengine_set_playing(engine: &mut GranularEngine, playing: bool) {
    engine.set_playing_internal(playing);
}

#[wasm_bindgen]
pub fn granularengine_process(engine: &mut GranularEngine, output_ptr: *mut f32, len: usize) {
    engine.process_internal(output_ptr, len);
}
