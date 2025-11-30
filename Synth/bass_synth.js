/*
 * BASS SYNTH MODULE (Optimized)
 * Caches distortion curves to prevent CPU spikes.
 */

class BassSynth {
    constructor() {
        this.ctx = null;
        this.masterGain = null;
        this.cachedDistCurve = null;
        this.currentDistAmount = -1; // Force initial calc
    }

    init(audioContext, outputNode) {
        this.ctx = audioContext;
        this.masterGain = outputNode;
        // Pre-calculate initial curve
        this.updateDistortionCurve(20);
    }

    updateDistortionCurve(amount) {
        // Only recalculate if changed
        if (amount === this.currentDistAmount && this.cachedDistCurve) return;
        
        this.currentDistAmount = amount;
        this.cachedDistCurve = this.makeDistortionCurve(amount);
    }

    play(note, octave, time, duration = 0.3, distortionAmount = 20) {
        if (!this.ctx) return;

        // Frequencies Map
        const noteMap = {'C':0,'C#':1,'D':2,'D#':3,'E':4,'F':5,'F#':6,'G':7,'G#':8,'A':9,'A#':10,'B':11};
        const noteIndex = noteMap[note];
        if (noteIndex === undefined) return;

        // MIDI Formula
        const midiNote = (octave + 1) * 12 + noteIndex;
        const freq = 440 * Math.pow(2, (midiNote - 69) / 12);

        // NODE CREATION
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const filter = this.ctx.createBiquadFilter();
        
        // 1. OSCILLATOR (Sawtooth)
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, time);
        // "Reese" detune effect (random phase/pitch drift)
        osc.detune.setValueAtTime((Math.random() * 10) - 5, time);

        // 2. FILTER (Lowpass with Envelope)
        filter.type = 'lowpass';
        const baseCutoff = 800 + (octave * 150);
        filter.frequency.setValueAtTime(baseCutoff, time);
        filter.Q.value = 4;
        filter.frequency.exponentialRampToValueAtTime(80, time + duration);

        // 3. ENVELOPE (ADSR)
        gain.gain.setValueAtTime(0, time);
        gain.gain.linearRampToValueAtTime(0.5, time + 0.02); // Fast Attack
        gain.gain.exponentialRampToValueAtTime(0.001, time + duration); // Decay

        // 4. GRAPH CONNECTION
        osc.connect(filter);

        // Apply Distortion only if needed
        if (distortionAmount > 0) {
            // Ensure curve is up to date
            if (distortionAmount !== this.currentDistAmount) {
                this.updateDistortionCurve(distortionAmount);
            }
            
            const shaper = this.ctx.createWaveShaper();
            shaper.curve = this.cachedDistCurve;
            shaper.oversample = '2x'; // '4x' is too heavy for mobile sometimes
            
            filter.connect(shaper);
            shaper.connect(gain);
        } else {
            filter.connect(gain);
        }

        gain.connect(this.masterGain);

        // START/STOP
        osc.start(time);
        osc.stop(time + duration + 0.05);
        
        // Garbage Collection Hint: Break references after play
        // (Automatic in JS, but good practice mentally)
        osc.onended = () => {
            osc.disconnect();
            gain.disconnect();
            filter.disconnect();
        };
    }

    makeDistortionCurve(amount) {
        const k = typeof amount === 'number' ? amount : 50;
        const n_samples = 22050; // Reduced sample count for speed (enough for web audio)
        const curve = new Float32Array(n_samples);
        const deg = Math.PI / 180;
        
        for (let i = 0; i < n_samples; ++i) {
            let x = i * 2 / n_samples - 1;
            curve[i] = (3 + k) * x * 20 * deg / (Math.PI + k * Math.abs(x));
        }
        return curve;
    }
}

window.bassSynth = new BassSynth();