/* * BASS SYNTH MODULE
 * Handles the creation of analog-style bass sounds using Web Audio API.
 */

class BassSynth {
    constructor() {
        this.ctx = null;
        this.masterGain = null;
    }

    // Must be called after user interaction
    init(audioContext, outputNode) {
        this.ctx = audioContext;
        this.masterGain = outputNode;
    }

    play(note, octave, time, duration = 0.3, distortionAmount = 20) {
        if (!this.ctx) return;

        // Frequencies Map
        const noteMap = {'C':0,'C#':1,'D':2,'D#':3,'E':4,'F':5,'F#':6,'G':7,'G#':8,'A':9,'A#':10,'B':11};
        const noteIndex = noteMap[note];
        if (noteIndex === undefined) return;

        // MIDI Formula: f = 440 * 2^((d-69)/12)
        const midiNote = (octave + 1) * 12 + noteIndex;
        const freq = 440 * Math.pow(2, (midiNote - 69) / 12);

        // NODE CREATION
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const filter = this.ctx.createBiquadFilter();
        const shaper = this.ctx.createWaveShaper();

        // 1. OSCILLATOR (Sawtooth for aggression)
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, time);
        // "Reese" detune effect (random phase/pitch drift)
        osc.detune.setValueAtTime((Math.random() * 20) - 10, time);

        // 2. FILTER (Lowpass)
        filter.type = 'lowpass';
        // Cutoff relates to pitch but adds movement
        const baseCutoff = 800 + (octave * 100);
        filter.frequency.setValueAtTime(baseCutoff, time);
        filter.Q.value = 6;
        // Filter Envelope (Wobble)
        filter.frequency.exponentialRampToValueAtTime(100, time + duration);

        // 3. DISTORTION (WaveShaper)
        shaper.curve = this.makeDistortionCurve(distortionAmount);
        shaper.oversample = '4x';

        // 4. GAIN ENVELOPE (ADSR)
        gain.gain.setValueAtTime(0, time);
        gain.gain.linearRampToValueAtTime(0.6, time + 0.02); // Attack
        gain.gain.exponentialRampToValueAtTime(0.001, time + duration); // Decay

        // CONNECT GRAPH
        osc.connect(filter);
        filter.connect(shaper);
        shaper.connect(gain);
        gain.connect(this.masterGain);

        // START/STOP
        osc.start(time);
        osc.stop(time + duration + 0.1);
    }

    makeDistortionCurve(amount) {
        const k = typeof amount === 'number' ? amount : 50;
        const n_samples = 44100;
        const curve = new Float32Array(n_samples);
        const deg = Math.PI / 180;
        
        for (let i = 0; i < n_samples; ++i) {
            let x = i * 2 / n_samples - 1;
            // Sigmoid-like distortion function
            curve[i] = (3 + k) * x * 20 * deg / (Math.PI + k * Math.abs(x));
        }
        return curve;
    }
}

// Export as global instance
window.bassSynth = new BassSynth();
