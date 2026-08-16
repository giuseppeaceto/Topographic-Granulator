use std::f32::consts::PI;

#[inline]
pub fn hermite(y0: f32, y1: f32, y2: f32, y3: f32, frac: f32) -> f32 {
    let c0 = y1;
    let c1 = 0.5 * (y2 - y0);
    let c2 = y0 - 2.5 * y1 + 2.0 * y2 - 0.5 * y3;
    let c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
    ((c3 * frac + c2) * frac + c1) * frac + c0
}

#[inline]
fn wrap_index(i: isize, len: usize) -> usize {
    let n = len as isize;
    if n <= 0 {
        return 0;
    }
    let mut x = i % n;
    if x < 0 {
        x += n;
    }
    x as usize
}

pub fn read_region_hermite(buf: &[f32], pos: f64, reg_start: usize, reg_end: usize) -> f32 {
    let buf_len = buf.len();
    let reg_end = reg_end.min(buf_len).max(reg_start.saturating_add(1));
    let reg_start = reg_start.min(reg_end - 1);
    let reg_len = (reg_end - reg_start) as isize;
    if reg_len <= 1 || buf_len == 0 {
        return 0.0;
    }

    const MIN_WRAP: usize = 128;
    const XFADE: usize = 64;

    if (reg_end - reg_start) < MIN_WRAP {
        let max_pos = (reg_end - 1) as f64;
        let pos = pos.clamp(reg_start as f64, max_pos);
        return hermite_taps_clamped(buf, pos, reg_start, reg_end);
    }

    let rel = (pos - reg_start as f64).rem_euclid(reg_len as f64);
    let fade = (XFADE.min((reg_end - reg_start) / 4)).max(1) as f64;
    let abs_pos = reg_start as f64 + rel;

    if rel + 1.0 < (reg_len as f64) - fade {
        return hermite_taps_wrapped(buf, abs_pos, reg_start, reg_len);
    }

    let t = ((rel - ((reg_len as f64) - fade)) / fade).clamp(0.0, 1.0) as f32;
    let end_pos = (reg_end as f64 - 1.0).min(abs_pos);
    let start_pos = reg_start as f64 + (rel - ((reg_len as f64) - fade)).clamp(0.0, fade);
    let a = hermite_taps_clamped(buf, end_pos, reg_start, reg_end);
    let b = hermite_taps_clamped(buf, start_pos, reg_start, reg_end);
    let w_a = (0.5 * PI * t).cos();
    let w_b = (0.5 * PI * t).sin();
    a * w_a + b * w_b
}

fn hermite_taps_clamped(buf: &[f32], pos: f64, reg_start: usize, reg_end: usize) -> f32 {
    let last = (reg_end - 1).min(buf.len().saturating_sub(1));
    let base = pos.floor();
    let frac = (pos - base) as f32;
    let i = (base as isize).clamp(reg_start as isize, last as isize);
    let y0 = buf[i.saturating_sub(1).clamp(reg_start as isize, last as isize) as usize];
    let y1 = buf[i as usize];
    let y2 = buf[(i + 1).clamp(reg_start as isize, last as isize) as usize];
    let y3 = buf[(i + 2).clamp(reg_start as isize, last as isize) as usize];
    hermite(y0, y1, y2, y3, frac)
}

fn hermite_taps_wrapped(buf: &[f32], pos: f64, reg_start: usize, reg_len: isize) -> f32 {
    let base = pos.floor();
    let frac = (pos - base) as f32;
    let rel = (base as isize) - (reg_start as isize);
    let i0 = wrap_index(rel - 1, reg_len as usize);
    let i1 = wrap_index(rel, reg_len as usize);
    let i2 = wrap_index(rel + 1, reg_len as usize);
    let i3 = wrap_index(rel + 2, reg_len as usize);
    hermite(
        buf[reg_start + i0],
        buf[reg_start + i1],
        buf[reg_start + i2],
        buf[reg_start + i3],
        frac,
    )
}

pub struct BiquadFilter {
    sample_rate: f32,
    cutoff: f32,
    q: f32,
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
    x1: f32,
    x2: f32,
    y1: f32,
    y2: f32,
}

impl BiquadFilter {
    pub fn new(sample_rate: f32) -> Self {
        let mut f = BiquadFilter {
            sample_rate,
            cutoff: 2000.0,
            q: 0.707,
            b0: 0.0,
            b1: 0.0,
            b2: 0.0,
            a1: 0.0,
            a2: 0.0,
            x1: 0.0,
            x2: 0.0,
            y1: 0.0,
            y2: 0.0,
        };
        f.calc_coeffs();
        f
    }

    pub fn set_params(&mut self, cutoff: f32, q: f32) {
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

        let b0_raw = (1.0 - cos_w0) / 2.0;
        let b1_raw = 1.0 - cos_w0;
        let b2_raw = (1.0 - cos_w0) / 2.0;
        let a0_raw = 1.0 + alpha;
        let a1_raw = -2.0 * cos_w0;
        let a2_raw = 1.0 - alpha;

        let inv_a0 = 1.0 / a0_raw;
        self.b0 = b0_raw * inv_a0;
        self.b1 = b1_raw * inv_a0;
        self.b2 = b2_raw * inv_a0;
        self.a1 = a1_raw * inv_a0;
        self.a2 = a2_raw * inv_a0;
    }

    pub fn process(&mut self, input: f32) -> f32 {
        let output = self.b0 * input + self.b1 * self.x1 + self.b2 * self.x2
            - self.a1 * self.y1
            - self.a2 * self.y2;

        self.x2 = self.x1;
        self.x1 = input;
        self.y2 = self.y1;
        self.y1 = output;

        if self.y1.abs() < 1e-20 {
            self.y1 = 0.0;
        }

        output
    }
}

pub struct DelayLine {
    buffer: Vec<f32>,
    write_pos: usize,
    sample_rate: f32,
}

impl DelayLine {
    pub fn new(max_delay_ms: f32, sample_rate: f32) -> Self {
        let len = ((max_delay_ms * 1.5) / 1000.0 * sample_rate) as usize + 100;
        DelayLine {
            buffer: vec![0.0; len.max(4)],
            write_pos: 0,
            sample_rate,
        }
    }

    pub fn new_samples(size_samples: usize, sample_rate: f32) -> Self {
        DelayLine {
            buffer: vec![0.0; size_samples.max(1)],
            write_pos: 0,
            sample_rate,
        }
    }

    pub fn read(&self, delay_ms: f32) -> f32 {
        let len = self.buffer.len();
        if len < 4 {
            return 0.0;
        }
        // write_pos is the next slot; delay of 0 must read the sample just written (offset 1).
        let delay_samples = (delay_ms / 1000.0 * self.sample_rate).max(1.0);
        let max_delay = (len - 2) as f32;
        let delay_samples = delay_samples.min(max_delay);
        let ptr = (self.write_pos as f32 - delay_samples).rem_euclid(len as f32);
        let idx = ptr.floor() as isize;
        let frac = ptr - idx as f32;
        hermite(
            self.buffer[wrap_index(idx - 1, len)],
            self.buffer[wrap_index(idx, len)],
            self.buffer[wrap_index(idx + 1, len)],
            self.buffer[wrap_index(idx + 2, len)],
            frac,
        )
    }

    pub fn read_at(&self, offset_samples: usize) -> f32 {
        let len = self.buffer.len();
        if len == 0 {
            return 0.0;
        }
        let r = if self.write_pos >= offset_samples {
            self.write_pos - offset_samples
        } else {
            self.write_pos + len - offset_samples
        };
        self.buffer[r % len]
    }

    pub fn write(&mut self, sample: f32) {
        self.buffer[self.write_pos] = sample;
        self.write_pos = (self.write_pos + 1) % self.buffer.len();
    }
}

struct Comb {
    delay: DelayLine,
    feedback: f32,
    filter_store: f32,
    damp: f32,
}

impl Comb {
    fn new(size: usize, sample_rate: f32) -> Self {
        Comb {
            delay: DelayLine::new_samples(size.max(1), sample_rate),
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

    fn set_feedback(&mut self, val: f32) {
        self.feedback = val;
    }
    fn set_damp(&mut self, val: f32) {
        self.damp = val;
    }
}

struct Allpass {
    delay: DelayLine,
    feedback: f32,
}

impl Allpass {
    fn new(size: usize, sample_rate: f32) -> Self {
        Allpass {
            delay: DelayLine::new_samples(size.max(1), sample_rate),
            feedback: 0.5,
        }
    }

    fn process(&mut self, input: f32) -> f32 {
        let buffered_val = self.delay.read_at(self.delay.buffer.len() - 1);
        let to_delay = input + (buffered_val * self.feedback);
        self.delay.write(to_delay);
        buffered_val - input
    }
}

const FIXED_GAIN: f32 = 0.015;
const SCALE_WET: f32 = 3.0;
const SCALE_DAMP: f32 = 0.4;
const SCALE_ROOM: f32 = 0.28;
const OFFSET_ROOM: f32 = 0.7;
const PREDELAY_MS: f32 = 20.0;
const STEREO_SPREAD: f32 = 23.0;

const COMB_TUNING_L: [usize; 8] = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const ALLPASS_TUNING_L: [usize; 4] = [556, 441, 341, 225];

pub struct Reverb {
    combs_l: Vec<Comb>,
    combs_r: Vec<Comb>,
    allpasses_l: Vec<Allpass>,
    allpasses_r: Vec<Allpass>,
    predelay_l: DelayLine,
    predelay_r: DelayLine,
    mix: f32,
}

impl Reverb {
    pub fn new(sample_rate: f32) -> Self {
        let sr_scale = sample_rate / 44100.0;
        let spread = (STEREO_SPREAD * sr_scale) as usize;

        let mut combs_l = Vec::new();
        let mut combs_r = Vec::new();
        for t in COMB_TUNING_L.iter() {
            let size = (*t as f32 * sr_scale) as usize;
            combs_l.push(Comb::new(size, sample_rate));
            combs_r.push(Comb::new(size + spread, sample_rate));
        }

        let mut allpasses_l = Vec::new();
        let mut allpasses_r = Vec::new();
        for t in ALLPASS_TUNING_L.iter() {
            let size = (*t as f32 * sr_scale) as usize;
            allpasses_l.push(Allpass::new(size, sample_rate));
            allpasses_r.push(Allpass::new(size + spread, sample_rate));
        }

        Reverb {
            combs_l,
            combs_r,
            allpasses_l,
            allpasses_r,
            predelay_l: DelayLine::new(PREDELAY_MS * 2.0, sample_rate),
            predelay_r: DelayLine::new(PREDELAY_MS * 2.0, sample_rate),
            mix: 0.0,
        }
    }

    pub fn set_params(&mut self, mix: f32, room_size: f32, damp: f32) {
        self.mix = mix.clamp(0.0, 1.0);
        let feedback = room_size.clamp(0.0, 1.0) * SCALE_ROOM + OFFSET_ROOM;
        let d = damp.clamp(0.0, 1.0) * SCALE_DAMP;

        for c in self.combs_l.iter_mut().chain(self.combs_r.iter_mut()) {
            c.set_feedback(feedback);
            c.set_damp(d);
        }
    }

    pub fn process(&mut self, input_l: f32, input_r: f32) -> (f32, f32) {
        if self.mix <= 0.001 {
            return (input_l, input_r);
        }

        let pred_l = self.predelay_l.read(PREDELAY_MS);
        self.predelay_l.write(input_l);
        let pred_r = self.predelay_r.read(PREDELAY_MS);
        self.predelay_r.write(input_r);

        let il = pred_l * FIXED_GAIN;
        let ir = pred_r * FIXED_GAIN;

        let mut out_l = 0.0;
        for c in self.combs_l.iter_mut() {
            out_l += c.process(il);
        }
        let mut out_r = 0.0;
        for c in self.combs_r.iter_mut() {
            out_r += c.process(ir);
        }

        for a in self.allpasses_l.iter_mut() {
            out_l = a.process(out_l);
        }
        for a in self.allpasses_r.iter_mut() {
            out_r = a.process(out_r);
        }

        let wet = self.mix * SCALE_WET;
        let dry = 1.0 - self.mix;
        (input_l * dry + out_l * wet, input_r * dry + out_r * wet)
    }
}

pub struct StereoLimiter {
    peak: f32,
    decay: f32,
    threshold: f32,
}

impl StereoLimiter {
    pub fn new(sample_rate: f32) -> Self {
        StereoLimiter {
            peak: 0.0,
            decay: (-1.0 / (0.05 * sample_rate)).exp(),
            threshold: 0.95,
        }
    }

    pub fn process(&mut self, l: f32, r: f32) -> (f32, f32) {
        let a = l.abs().max(r.abs());
        if a > self.peak {
            self.peak = a;
        } else {
            self.peak *= self.decay;
        }
        if self.peak < 1e-20 {
            self.peak = 0.0;
        }
        if self.peak > self.threshold {
            let g = self.threshold / self.peak;
            (l * g, r * g)
        } else {
            (l, r)
        }
    }
}
