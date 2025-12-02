/*
 * BASS SYNTH MODULE (With FX Chain)
 */

class BassSynth {
    constructor(id = 'bass-1') {
        this.id = id;
        this.ctx = null;
        this.output = null;
        this.fxChain = null;
        
        this.params = {
            distortion: 20,
            cutoff: 800,
            resonance: 4
        };
    }

    init(audioContext, destinationNode) {
        this.ctx = audioContext;
        
        // Main Output
        this.output = this.ctx.createGain();
        this.output.connect(destinationNode);

        // Load FX Chain
        try {
            if (typeof window.BassFXChain !== 'undefined') {
                this.fxChain = new window.BassFXChain(this.ctx);
                this.fxChain.setDistortion(this.params.distortion);
                this.fxChain.connect(this.output);
            }
        } catch (e) {
            console.warn("FX Chain Error", e);
        }
    }

    setDistortion(val) {
        this.params.distortion = val;
        if (this.fxChain) this.fxChain.setDistortion(val);
    }
    setCutoff(val) { this.params.cutoff = val; }
    setResonance(val) { this.params.resonance = val; }

    play(note, octave, time, duration = 0.25) {
        if (!this.ctx) return;

        const noteMap = {'C':0,'C#':1,'D':2,'D#':3,'E':4,'F':5,'F#':6,'G':7,'G#':8,'A':9,'A#':10,'B':11};
        const noteIndex = noteMap[note];
        if (noteIndex === undefined) return;

        const midiNote = (octave + 1) * 12 + noteIndex;
        const freq = 440 * Math.pow(2, (midiNote - 69) / 12);

        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const filter = this.ctx.createBiquadFilter();

        // OSC
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, time);
        osc.detune.setValueAtTime((Math.random() * 8) - 4, time); 

        // FILTER (Dynamic)
        filter.type = 'lowpass';
        // Cutoff modulation
        const baseCutoff = this.params.cutoff;
        filter.frequency.setValueAtTime(baseCutoff, time);
        filter.Q.value = this.params.resonance;
        
        // Filter Envelope
        const attackTime = 0.05;
        const decayTime = duration;
        filter.frequency.linearRampToValueAtTime(baseCutoff + 1000, time + attackTime);
        filter.frequency.exponentialRampToValueAtTime(baseCutoff, time + attackTime + decayTime);

        // AMP
        gain.gain.setValueAtTime(0, time);
        gain.gain.linearRampToValueAtTime(0.5, time + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

        // ROUTING
        osc.connect(filter);
        filter.connect(gain);
        
        // FX Chain Injection
        if (this.fxChain) {
            gain.connect(this.fxChain.input);
        } else {
            gain.connect(this.output);
        }

        osc.start(time);
        osc.stop(time + duration + 0.1);

        osc.onended = () => {
            osc.disconnect();
            gain.disconnect();
            filter.disconnect();
        };
    }
}

window.BassSynth = BassSynth;