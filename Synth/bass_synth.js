/*
 * BASS SYNTH MODULE (Modular & Instantiable)
 * Contains Oscillator, Filter, Envelope and Effects Chain.
 */

class BassSynth {
    constructor(id = 'bass-1') {
        this.id = id;
        this.ctx = null;
        this.output = null;
        
        // Effects Chain
        this.distortionEffect = null;
        
        // State
        this.params = {
            distortion: 20,
            cutoffBase: 800
        };
    }

    /**
     * Initialize the synth with AudioContext and route to destination
     */
    init(audioContext, destinationNode) {
        this.ctx = audioContext;
        
        // Create Main Output
        this.output = this.ctx.createGain();
        this.output.connect(destinationNode);

        // Instantiate Effects
        this.distortionEffect = new DistortionEffect(this.ctx);
        this.distortionEffect.setAmount(this.params.distortion);

        // Final Routing: Effect -> Synth Output
        this.distortionEffect.connect(this.output);
    }

    /**
     * Update specific effect parameters dynamically
     */
    setDistortion(amount) {
        this.params.distortion = amount;
        if (this.distortionEffect) {
            this.distortionEffect.setAmount(amount);
        }
    }

    /**
     * Trigger a note
     */
    play(note, octave, time, duration = 0.3) {
        if (!this.ctx) return;

        // --- 1. Sound Generation (Oscillators) ---
        const noteMap = {'C':0,'C#':1,'D':2,'D#':3,'E':4,'F':5,'F#':6,'G':7,'G#':8,'A':9,'A#':10,'B':11};
        const noteIndex = noteMap[note];
        if (noteIndex === undefined) return;

        const midiNote = (octave + 1) * 12 + noteIndex;
        const freq = 440 * Math.pow(2, (midiNote - 69) / 12);

        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const filter = this.ctx.createBiquadFilter();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, time);
        osc.detune.setValueAtTime((Math.random() * 10) - 5, time); // Reese drift

        // --- 2. Filter (LPF) ---
        filter.type = 'lowpass';
        const cutoff = this.params.cutoffBase + (octave * 150);
        filter.frequency.setValueAtTime(cutoff, time);
        filter.Q.value = 4;
        filter.frequency.exponentialRampToValueAtTime(80, time + duration);

        // --- 3. Amplitude Envelope (ADSR) ---
        gain.gain.setValueAtTime(0, time);
        gain.gain.linearRampToValueAtTime(0.5, time + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

        // --- 4. Internal Routing ---
        // Osc -> Filter -> Amp -> Effects Chain Input
        osc.connect(filter);
        filter.connect(gain);
        
        // Route to Distortion Effect Input
        gain.connect(this.distortionEffect.input);

        // Start/Stop
        osc.start(time);
        osc.stop(time + duration + 0.05);

        // Garbage collection helper
        osc.onended = () => {
            osc.disconnect();
            gain.disconnect();
            filter.disconnect();
        };
    }
}