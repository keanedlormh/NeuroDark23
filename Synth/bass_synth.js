/*
 * BASS SYNTH MODULE (Safe Mode)
 * Robust initialization that doesn't crash if effects are missing.
 */

class BassSynth {
    constructor(id = 'bass-1') {
        this.id = id;
        this.ctx = null;
        this.output = null;
        this.distortionEffect = null;
        this.params = {
            distortion: 20,
            cutoffBase: 800
        };
    }

    init(audioContext, destinationNode) {
        this.ctx = audioContext;
        
        // Main Output
        this.output = this.ctx.createGain();
        this.output.connect(destinationNode);

        // Try to load effects safely
        try {
            if (typeof DistortionEffect !== 'undefined') {
                this.distortionEffect = new DistortionEffect(this.ctx);
                this.distortionEffect.setAmount(this.params.distortion);
                // Routing: Effect -> Output
                this.distortionEffect.connect(this.output);
            } else {
                console.warn("DistortionEffect class not found. Running in clean mode.");
            }
        } catch (e) {
            console.error("Effect Init Error:", e);
        }
    }

    setDistortion(amount) {
        this.params.distortion = amount;
        if (this.distortionEffect) {
            this.distortionEffect.setAmount(amount);
        }
    }

    play(note, octave, time, duration = 0.3) {
        if (!this.ctx) return;

        // Frequencies
        const noteMap = {'C':0,'C#':1,'D':2,'D#':3,'E':4,'F':5,'F#':6,'G':7,'G#':8,'A':9,'A#':10,'B':11};
        const noteIndex = noteMap[note];
        if (noteIndex === undefined) return;

        const midiNote = (octave + 1) * 12 + noteIndex;
        const freq = 440 * Math.pow(2, (midiNote - 69) / 12);

        // Nodes
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const filter = this.ctx.createBiquadFilter();

        // Config
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, time);
        osc.detune.setValueAtTime((Math.random() * 10) - 5, time); 

        filter.type = 'lowpass';
        const cutoff = this.params.cutoffBase + (octave * 150);
        filter.frequency.setValueAtTime(cutoff, time);
        filter.Q.value = 4;
        filter.frequency.exponentialRampToValueAtTime(80, time + duration);

        gain.gain.setValueAtTime(0, time);
        gain.gain.linearRampToValueAtTime(0.5, time + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

        // Connections
        osc.connect(filter);
        filter.connect(gain);
        
        // Route to Effect or Direct Output
        if (this.distortionEffect) {
            gain.connect(this.distortionEffect.input);
        } else {
            gain.connect(this.output);
        }

        // Play
        osc.start(time);
        osc.stop(time + duration + 0.05);

        // Cleanup
        osc.onended = () => {
            osc.disconnect();
            gain.disconnect();
            filter.disconnect();
        };
    }
}