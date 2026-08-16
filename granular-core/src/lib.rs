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
    length: f64,
    age: f64,
    attack: f32,
    release: f32,
    inv_attack: f32,
    inv_release: f32,
}

impl Grain {
    fn empty() -> Self {
        Grain {
            active: false,
            start_sample: 0.0,
            length: 0.0,
            age: 0.0,
            attack: 0.2,
            release: 0.25,
            inv_attack: 5.0,
            inv_release: 4.0,
        }
    }

    fn init(&mut self, start: f64, length: f64, tight: bool) {
        let length_f = length as f32;
        let attack = if tight {
            (3.0 / length_f).min(0.04)
        } else {
            0.2f32.min(10.0 / length_f)
        };
        let release = 0.25f32.min(12.0 / length_f);
        self.active = true;
        self.start_sample = start;
        self.length = length;
        self.age = 0.0;
        self.attack = attack;
        self.release = release;
        self.inv_attack = 1.0 / attack.max(1e-6);
        self.inv_release = 1.0 / release.max(1e-6);
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

// 64 covers density 60 × 200 ms (~12) plus marker bursts (up to 32) with headroom.
const MAX_GRAINS: usize = 64;

#[wasm_bindgen]
pub struct GranularEngine {
    sample_rate: f32,
    audio_buffer: Vec<f32>,
    grains: [Grain; MAX_GRAINS],
    active: [u16; MAX_GRAINS],
    active_count: usize,
    free: [u16; MAX_GRAINS],
    free_count: usize,

    // Params
    grain_size_ms: f32,
    density: f32,
    random_start_ms: f32,
    pitch_semitones: f32,
    target_pitch_semitones: f64,
    current_pitch_semitones: f64,
    current_rate: f64,
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

    cutoff_target: f32,
    cutoff_current: f32,
    q_target: f32,
    q_current: f32,
    delay_time_target: f32,
    delay_feedback_target: f32,
    delay_mix_target: f32,
    reverb_mix_target: f32,
    master_gain_target: f32,
    fx_smooth_alpha: f32,
    delay_time_alpha: f32,
    region_alpha: f64,

    region_start_target: usize,
    region_end_target: usize,
    region_start_f: f64,
    region_end_f: f64,

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

fn make_index_range() -> [u16; MAX_GRAINS] {
    let mut ids = [0u16; MAX_GRAINS];
    let mut i = 0;
    while i < MAX_GRAINS {
        ids[i] = i as u16;
        i += 1;
    }
    ids
}

#[wasm_bindgen]
impl GranularEngine {
    #[wasm_bindgen(constructor)]
    pub fn new(sample_rate: f32) -> GranularEngine {
        GranularEngine {
            sample_rate,
            audio_buffer: Vec::new(),
            grains: [Grain::empty(); MAX_GRAINS],
            active: [0; MAX_GRAINS],
            active_count: 0,
            free: make_index_range(),
            free_count: MAX_GRAINS,

            grain_size_ms: 80.0,
            density: 15.0,
            random_start_ms: 40.0,
            pitch_semitones: 0.0,
            target_pitch_semitones: 0.0,
            current_pitch_semitones: 0.0,
            current_rate: 1.0,
            pitch_smooth_alpha: 1.0 - (-1.0 / (0.045 * sample_rate as f64)).exp(), // ~45ms portamento glide

            filter: BiquadFilter::new(sample_rate),
            delay: DelayLine::new(2000.0, sample_rate), // 2s max delay
            reverb: Reverb::new(sample_rate),

            delay_mix: 0.0,
            delay_feedback: 0.3,
            delay_time_ms: 250.0,
            reverb_mix: 0.0,
            master_gain: 1.0,

            cutoff_target: 4000.0,
            cutoff_current: 4000.0,
            q_target: 0.707,
            q_current: 0.707,
            delay_time_target: 250.0,
            delay_feedback_target: 0.3,
            delay_mix_target: 0.0,
            reverb_mix_target: 0.0,
            master_gain_target: 1.0,
            fx_smooth_alpha: 1.0 - (-1.0 / (0.012 * sample_rate)).exp(),
            delay_time_alpha: 1.0 - (-1.0 / (0.02 * sample_rate)).exp(),
            region_alpha: 1.0 - (-1.0 / (0.025 * sample_rate as f64)).exp(),

            region_start_target: 0,
            region_end_target: 0,
            region_start_f: 0.0,
            region_end_f: 0.0,

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
        self.snap_region(0, self.audio_buffer.len());
    }

    fn snap_region(&mut self, start: usize, end: usize) {
        let len = self.audio_buffer.len();
        let start = start.min(len);
        let end = end.min(len).max(start);
        self.region_start_target = start;
        self.region_end_target = end;
        self.region_start_f = start as f64;
        self.region_end_f = end as f64;
        self.region_start = start;
        self.region_end = end;
    }

    fn set_region_internal(&mut self, start: usize, end: usize) {
        let len = self.audio_buffer.len();
        if len == 0 {
            return;
        }
        self.region_start_target = start.min(len);
        self.region_end_target = end.min(len).max(self.region_start_target);
    }

    fn set_params_internal(
        &mut self,
        grain_size_ms: f32,
        density: f32,
        random_start_ms: f32,
        pitch_semitones: f32,
    ) {
        self.grain_size_ms = grain_size_ms;
        self.density = density;
        self.random_start_ms = random_start_ms;
        self.pitch_semitones = pitch_semitones;
        self.target_pitch_semitones = pitch_semitones as f64;
    }

    fn set_effect_params_internal(
        &mut self,
        cutoff: f32,
        q: f32,
        delay_time_ms: f32,
        delay_feedback: f32,
        delay_mix: f32,
        reverb_mix: f32,
        master_gain: f32,
    ) {
        self.cutoff_target = cutoff;
        self.q_target = q;
        self.delay_time_target = delay_time_ms.max(0.0);
        self.delay_feedback_target = delay_feedback.clamp(0.0, 0.95);
        self.delay_mix_target = delay_mix.clamp(0.0, 1.0);
        self.reverb_mix_target = reverb_mix.clamp(0.0, 1.0);
        self.master_gain_target = master_gain.max(0.0);
    }

    fn snap_effect_params(&mut self) {
        self.cutoff_current = self.cutoff_target;
        self.q_current = self.q_target;
        self.delay_time_ms = self.delay_time_target;
        self.delay_feedback = self.delay_feedback_target;
        self.delay_mix = self.delay_mix_target;
        self.reverb_mix = self.reverb_mix_target;
        self.master_gain = self.master_gain_target;
        self.filter.set_params(self.cutoff_current, self.q_current);
        self.reverb.set_params(self.reverb_mix, 0.5, 0.5);
    }

    fn smooth_toward(current: f32, target: f32, alpha: f32, eps: f32) -> f32 {
        let delta = target - current;
        if delta.abs() <= eps {
            target
        } else {
            current + delta * alpha
        }
    }

    fn tick_smoothed_params(&mut self) {
        let cutoff_target = self.cutoff_target.max(20.0);
        let cutoff_current = self.cutoff_current.max(20.0);
        if (cutoff_target - cutoff_current).abs() <= 0.25 {
            self.cutoff_current = cutoff_target;
        } else {
            let log_c = cutoff_current.ln();
            let log_t = cutoff_target.ln();
            self.cutoff_current = (log_c + (log_t - log_c) * self.fx_smooth_alpha).exp();
        }
        self.q_current = Self::smooth_toward(self.q_current, self.q_target, self.fx_smooth_alpha, 0.001);
        self.filter.set_params(self.cutoff_current, self.q_current);

        self.delay_time_ms = Self::smooth_toward(
            self.delay_time_ms,
            self.delay_time_target,
            self.delay_time_alpha,
            0.05,
        );
        self.delay_feedback = Self::smooth_toward(
            self.delay_feedback,
            self.delay_feedback_target,
            self.fx_smooth_alpha,
            1e-4,
        );
        self.delay_mix = Self::smooth_toward(
            self.delay_mix,
            self.delay_mix_target,
            self.fx_smooth_alpha,
            1e-4,
        );
        let new_reverb = Self::smooth_toward(
            self.reverb_mix,
            self.reverb_mix_target,
            self.fx_smooth_alpha,
            1e-4,
        );
        if (new_reverb - self.reverb_mix).abs() > 1e-6 {
            self.reverb_mix = new_reverb;
            self.reverb.set_params(self.reverb_mix, 0.5, 0.5);
        }
        self.master_gain = Self::smooth_toward(
            self.master_gain,
            self.master_gain_target,
            self.fx_smooth_alpha,
            1e-4,
        );

        let start_t = self.region_start_target as f64;
        let end_t = self.region_end_target as f64;
        let start_d = start_t - self.region_start_f;
        let end_d = end_t - self.region_end_f;
        if start_d.abs() <= 1.0 && end_d.abs() <= 1.0 {
            self.region_start_f = start_t;
            self.region_end_f = end_t;
        } else {
            self.region_start_f += start_d * self.region_alpha;
            self.region_end_f += end_d * self.region_alpha;
        }
        let len = self.audio_buffer.len();
        let start = (self.region_start_f as usize).min(len);
        let end = (self.region_end_f as usize).min(len).max(start);
        self.region_start = start;
        self.region_end = end;
    }

    // Metodo unificato per aggiornare tutto lo stato (preset recall optimization)
    fn set_all_params_internal(
        &mut self,
        grain_size_ms: f32,
        density: f32,
        random_start_ms: f32,
        pitch_semitones: f32,
        cutoff: f32,
        q: f32,
        delay_time_ms: f32,
        delay_feedback: f32,
        delay_mix: f32,
        reverb_mix: f32,
        master_gain: f32,
        region_start: usize,
        region_end: usize,
    ) {
        self.set_params_internal(grain_size_ms, density, random_start_ms, pitch_semitones);
        self.set_effect_params_internal(
            cutoff,
            q,
            delay_time_ms,
            delay_feedback,
            delay_mix,
            reverb_mix,
            master_gain,
        );
        self.snap_effect_params();
        self.snap_region(region_start, region_end);
    }

    fn set_playing_internal(&mut self, playing: bool) {
        self.is_playing = playing;
        // Keeping ringing on stop is nicer
    }

    fn update_pitch_rate(&mut self) {
        let delta = self.target_pitch_semitones - self.current_pitch_semitones;
        if delta.abs() < 1e-9 {
            if self.current_pitch_semitones != self.target_pitch_semitones {
                self.current_pitch_semitones = self.target_pitch_semitones;
                self.current_rate = 2.0f64.powf(self.current_pitch_semitones / 12.0);
            }
            return;
        }
        self.current_pitch_semitones += delta * self.pitch_smooth_alpha;
        self.current_rate = 2.0f64.powf(self.current_pitch_semitones / 12.0);
    }

    fn mix_active_grains(&mut self, current_rate: f64, buf_len: usize) -> f32 {
        if self.active_count == 0 {
            return 0.0;
        }

        let reg_start = self.region_start;
        let reg_end = self.region_end.max(reg_start + 1);
        let reg_len = reg_end - reg_start;
        let mut current_sample = 0.0;
        let mut i = 0;

        while i < self.active_count {
            let gi = self.active[i] as usize;
            let (amp, start_sample, age, length) = {
                let g = &self.grains[gi];
                let env_pos = (g.age / g.length) as f32;
                let amp = if env_pos < g.attack {
                    env_pos * g.inv_attack
                } else if env_pos > 1.0 - g.release {
                    (1.0 - env_pos) * g.inv_release
                } else {
                    1.0
                };
                (amp, g.start_sample, g.age, g.length)
            };

            let raw_pos = start_sample.floor() as usize;
            let rel_pos = if raw_pos >= reg_start {
                raw_pos - reg_start
            } else {
                0
            };
            let clamped_pos = reg_start + (rel_pos % reg_len);
            let next_pos = reg_start + ((rel_pos + 1) % reg_len);
            let frac = (start_sample - start_sample.floor()) as f32;

            let s = if clamped_pos < buf_len && next_pos < buf_len {
                let s1 = self.audio_buffer[clamped_pos];
                let s2 = self.audio_buffer[next_pos];
                s1 + (s2 - s1) * frac
            } else {
                0.0
            };

            current_sample += s * amp;

            let g = &mut self.grains[gi];
            g.start_sample = start_sample + current_rate;
            g.age = age + 1.0;
            if g.age >= length {
                g.active = false;
                self.active_count -= 1;
                self.active[i] = self.active[self.active_count];
                self.free[self.free_count] = gi as u16;
                self.free_count += 1;
            } else {
                i += 1;
            }
        }

        current_sample
    }

    fn process_internal(&mut self, output_ptr: *mut f32, len: usize) {
        let output = unsafe { std::slice::from_raw_parts_mut(output_ptr, len) };

        let density = self.density.max(0.1);
        let interval_samples = self.sample_rate / density;
        let buf_len = self.audio_buffer.len();
        let can_spawn = buf_len > 0 && self.is_playing && self.auto_spawn;

        for i in 0..len {
            self.update_pitch_rate();
            self.tick_smoothed_params();
            let current_rate = self.current_rate;
            let delay_mix = self.delay_mix;
            let delay_fb = self.delay_feedback;
            let delay_time = self.delay_time_ms;
            let master_gain = self.master_gain;

            if can_spawn {
                self.time_since_last_grain += 1.0;
                if self.time_since_last_grain >= interval_samples {
                    self.spawn_grain(false);
                    self.time_since_last_grain -= interval_samples;
                }
            }

            let current_sample = if buf_len > 0 {
                self.mix_active_grains(current_rate, buf_len)
            } else {
                0.0
            };

            let filtered = self.filter.process(current_sample);

            let delayed_sig = self.delay.read(delay_time);
            let delay_in = filtered + (delayed_sig * delay_fb);
            self.delay.write(delay_in);

            let delay_out = filtered * (1.0 - delay_mix) + delayed_sig * delay_mix;
            let reverb_out = self.reverb.process(delay_out);
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
        if self.free_count == 0 {
            return;
        }

        let reg_start = self.region_start as f64;
        let reg_end = self.region_end as f64;
        let reg_len = (reg_end - reg_start).max(1.0);

        let origin = if self.grain_anchor_enabled {
            self.grain_anchor_sample
        } else {
            reg_start
        };

        let rand_val = self.rng.next_f32() as f64;
        let max_rand_offset =
            ((self.random_start_ms / 1000.0) as f64 * (self.sample_rate as f64)).min(reg_len);
        let rand_offset = (rand_val * 2.0 - 1.0) * max_rand_offset;

        let mut start = origin + rand_offset;
        if start < reg_start {
            start = reg_start;
        }
        if start >= reg_end {
            start = (reg_end - 1.0).max(reg_start);
        }

        let length = ((self.grain_size_ms / 1000.0) as f64 * (self.sample_rate as f64)).max(1.0);

        self.free_count -= 1;
        let gi = self.free[self.free_count] as usize;
        self.grains[gi].init(start, length, tight);
        self.active[self.active_count] = gi as u16;
        self.active_count += 1;
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
pub fn granularengine_set_params(
    engine: &mut GranularEngine,
    grain_size_ms: f32,
    density: f32,
    random_start_ms: f32,
    pitch_semitones: f32,
) {
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
    master_gain: f32,
) {
    engine.set_effect_params_internal(
        cutoff,
        q,
        delay_time_ms,
        delay_feedback,
        delay_mix,
        reverb_mix,
        master_gain,
    );
}

#[wasm_bindgen]
pub fn granularengine_set_all_params(
    engine: &mut GranularEngine,
    grain_size_ms: f32,
    density: f32,
    random_start_ms: f32,
    pitch_semitones: f32,
    cutoff: f32,
    q: f32,
    delay_time_ms: f32,
    delay_feedback: f32,
    delay_mix: f32,
    reverb_mix: f32,
    master_gain: f32,
    region_start: usize,
    region_end: usize,
) {
    engine.set_all_params_internal(
        grain_size_ms,
        density,
        random_start_ms,
        pitch_semitones,
        cutoff,
        q,
        delay_time_ms,
        delay_feedback,
        delay_mix,
        reverb_mix,
        master_gain,
        region_start,
        region_end,
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
