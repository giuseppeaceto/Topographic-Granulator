use std::f32::consts::PI;

// --- Biquad Filter (Lowpass) ---
pub struct BiquadFilter {
    sample_rate: f32,
    cutoff: f32,
    q: f32,
    
    // Normalized Coefficients
    b0: f32, b1: f32, b2: f32,
    a1: f32, a2: f32,
    
    // State (History)
    x1: f32, x2: f32,
    y1: f32, y2: f32,
}

impl BiquadFilter {
    pub fn new(sample_rate: f32) -> Self {
        let mut f = BiquadFilter {
            sample_rate,
            cutoff: 2000.0,
            q: 0.707,
            b0: 0.0, b1: 0.0, b2: 0.0,
            a1: 0.0, a2: 0.0,
            x1: 0.0, x2: 0.0,
            y1: 0.0, y2: 0.0,
        };
        f.calc_coeffs();
        f
    }

    pub fn set_params(&mut self, cutoff: f32, q: f32) {
        // Safety clamps
        let cutoff = cutoff.max(20.0).min(self.sample_rate * 0.49);
        let q = q.max(0.1).min(10.0);
        
        if (self.cutoff - cutoff).abs() > 0.1 || (self.q - q).abs() > 0.01 {
            self.cutoff = cutoff;
            self.q = q;
            self.calc_coeffs();
        }
    }

    fn calc_coeffs(&mut self) {
        let w0 = 2.0 * PI * self.cutoff / self.sample_rate;
        let alpha = w0.sin() / (2.0 * self.q);
        let cos_w0 = w0.cos();

        // Lowpass coefficients (RBJ Audio EQ Cookbook)
        let b0_raw = (1.0 - cos_w0) / 2.0;
        let b1_raw = 1.0 - cos_w0;
        let b2_raw = (1.0 - cos_w0) / 2.0;
        let a0_raw = 1.0 + alpha;
        let a1_raw = -2.0 * cos_w0;
        let a2_raw = 1.0 - alpha;

        // Normalize by a0
        let inv_a0 = 1.0 / a0_raw;
        self.b0 = b0_raw * inv_a0;
        self.b1 = b1_raw * inv_a0;
        self.b2 = b2_raw * inv_a0;
        self.a1 = a1_raw * inv_a0;
        self.a2 = a2_raw * inv_a0;
    }

    pub fn process(&mut self, input: f32) -> f32 {
        // Direct Form I
        let output = self.b0 * input + self.b1 * self.x1 + self.b2 * self.x2
                   - self.a1 * self.y1 - self.a2 * self.y2;
        
        // Update state
        self.x2 = self.x1;
        self.x1 = input;
        self.y2 = self.y1;
        self.y1 = output;
        
        // Denormal protection (optional but good for silence)
        if self.y1.abs() < 1e-20 { self.y1 = 0.0; }
        
        output
    }
    
    pub fn reset(&mut self) {
        self.x1 = 0.0; self.x2 = 0.0;
        self.y1 = 0.0; self.y2 = 0.0;
    }
}

// --- Delay Line ---
pub struct DelayLine {
    buffer: Vec<f32>,
    write_pos: usize,
    sample_rate: f32,
}

impl DelayLine {
    pub fn new(max_delay_ms: f32, sample_rate: f32) -> Self {
        // Add some headroom
        let len = ((max_delay_ms * 1.5) / 1000.0 * sample_rate) as usize + 100;
        DelayLine {
            buffer: vec![0.0; len],
            write_pos: 0,
            sample_rate,
        }
    }
    
    // For direct access with integer size (used in Reverb)
    pub fn new_samples(size_samples: usize, sample_rate: f32) -> Self {
        DelayLine {
            buffer: vec![0.0; size_samples],
            write_pos: 0,
            sample_rate,
        }
    }

    // Reads from delay line at 'delay_ms' in the past
    pub fn read(&self, delay_ms: f32) -> f32 {
        let delay_samples = (delay_ms / 1000.0 * self.sample_rate).max(0.0);
        let read_ptr_raw = self.write_pos as f32 - delay_samples;
        
        // Wrap logic handled by using modulo on integer parts
        let len_f = self.buffer.len() as f32;
        let mut ptr = read_ptr_raw;
        while ptr < 0.0 { ptr += len_f; }
        while ptr >= len_f { ptr -= len_f; }
        
        let idx_int = ptr.floor() as usize;
        let frac = ptr - idx_int as f32;
        
        let idx_next = (idx_int + 1) % self.buffer.len();
        
        let s1 = self.buffer[idx_int];
        let s2 = self.buffer[idx_next];
        
        // Linear interpolation
        s1 + (s2 - s1) * frac
    }
    
    // Reads from exact sample offset (for fixed reverbs)
    pub fn read_at(&self, offset_samples: usize) -> f32 {
         let r = if self.write_pos >= offset_samples {
             self.write_pos - offset_samples
         } else {
             self.write_pos + self.buffer.len() - offset_samples
         };
         self.buffer[r]
    }

    // Writes new sample into buffer
    pub fn write(&mut self, sample: f32) {
        self.buffer[self.write_pos] = sample;
        self.write_pos = (self.write_pos + 1) % self.buffer.len();
    }
    
    pub fn reset(&mut self) {
        for x in self.buffer.iter_mut() { *x = 0.0; }
    }
}

// --- Reverb Primitives ---

struct Comb {
    delay: DelayLine,
    feedback: f32,
    filter_store: f32,
    damp: f32,
}

impl Comb {
    fn new(size: usize, sample_rate: f32) -> Self {
        Comb {
            delay: DelayLine::new_samples(size, sample_rate),
            feedback: 0.5,
            filter_store: 0.0,
            damp: 0.2,
        }
    }
    
    fn process(&mut self, input: f32) -> f32 {
        let output = self.delay.read_at(self.delay.buffer.len() - 1);
        
        self.filter_store = output * (1.0 - self.damp) + self.filter_store * self.damp;
        
        let to_delay = input + self.filter_store * self.feedback;
        self.delay.write(to_delay);
        
        output
    }
    
    fn set_feedback(&mut self, val: f32) { self.feedback = val; }
    fn set_damp(&mut self, val: f32) { self.damp = val; }
}

struct Allpass {
    delay: DelayLine,
    feedback: f32,
}

impl Allpass {
    fn new(size: usize, sample_rate: f32) -> Self {
        Allpass {
            delay: DelayLine::new_samples(size, sample_rate),
            feedback: 0.5,
        }
    }
    
    fn process(&mut self, input: f32) -> f32 {
        let buffered_val = self.delay.read_at(self.delay.buffer.len() - 1);
        let to_delay = input + (buffered_val * self.feedback);
        self.delay.write(to_delay);
        
        // Output = -input + buffered
        // Standard Schroder Allpass: y[n] = -g * x[n] + x[n-D] + g * y[n-D]
        // Implementation here: 
        // buf = x[n-D] + g * y[n-D] (stored)
        // out = -x[n] + buf(stored) ?? 
        // Let's stick to Freeverb form:
        // output = buffered - input 
        // buffer_input = input + buffered * feedback
        
        buffered_val - input
    }
}

// --- Freeverb Implementation ---
// Tunings from Freeverb
const FIXED_GAIN: f32 = 0.015;
const SCALE_WET: f32 = 3.0;
const SCALE_DRY: f32 = 2.0;
const SCALE_DAMP: f32 = 0.4;
const SCALE_ROOM: f32 = 0.28;
const OFFSET_ROOM: f32 = 0.7;

// Stereo spread not implemented, mono version here
const COMB_TUNING_L: [usize; 8] = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const ALLPASS_TUNING_L: [usize; 4] = [556, 441, 341, 225];

pub struct Reverb {
    combs: Vec<Comb>,
    allpasses: Vec<Allpass>,
    mix: f32, // 0..1
}

impl Reverb {
    pub fn new(sample_rate: f32) -> Self {
        // Scale tunings by sample rate (original is 44100)
        let sr_scale = sample_rate / 44100.0;
        
        let mut combs = Vec::new();
        for t in COMB_TUNING_L.iter() {
            combs.push(Comb::new((*t as f32 * sr_scale) as usize, sample_rate));
        }
        
        let mut allpasses = Vec::new();
        for t in ALLPASS_TUNING_L.iter() {
            allpasses.push(Allpass::new((*t as f32 * sr_scale) as usize, sample_rate));
        }
        
        Reverb {
            combs,
            allpasses,
            mix: 0.0,
        }
    }
    
    pub fn set_params(&mut self, mix: f32, room_size: f32, damp: f32) {
        self.mix = mix.clamp(0.0, 1.0);
        let feedback = room_size * SCALE_ROOM + OFFSET_ROOM;
        let d = damp * SCALE_DAMP;
        
        for c in self.combs.iter_mut() {
            c.set_feedback(feedback);
            c.set_damp(d);
        }
    }
    
    pub fn process(&mut self, input: f32) -> f32 {
        if self.mix <= 0.001 {
            return input;
        }
        
        let input_scaled = input * FIXED_GAIN;
        let mut out = 0.0;
        
        // Parallel Combs
        for c in self.combs.iter_mut() {
            out += c.process(input_scaled);
        }
        
        // Series Allpasses
        for a in self.allpasses.iter_mut() {
            out = a.process(out);
        }
        
        // Mix
        input * (1.0 - self.mix) + out * self.mix * SCALE_WET
    }
}
