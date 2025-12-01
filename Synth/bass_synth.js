/*
 * BASS SYNTH MODULE (Instantiable & Modular)
 * Features: Internal Audio Bus & Pluggable Effects
 */

class BassSynth {
    constructor(name = "Bass") {
        this.name = name;
        this.ctx = null;
        
        // Internal Routing
        this.outputNode = null; // Where the synth sends final audio
        this.dryBus = null;     // Internal bus before effects
        
        // Effects Chain
        this.distortion = new DistortionEffect();
        
        // Settings
        this.settings = {
            cutoffBase: 800,
            resonance: 4,
            release: 0.3
        };
    }

    /**
     * Initialize Audio Context and Routing Graph
     * @param {AudioContext} ctx 
     * @param {AudioNode} destination - Usually Master Gain
     */
    init(ctx, destination) {
        this.ctx = ctx;
        this.outputNode = destination;

        // 1. Create Internal Bus (Gain Node)
        // All polyphonic voices will sum here BEFORE effects
        this.dryBus = ctx.createGain();
        this.dryBus.gain.value = 1.0; 

        // 2. Initialize Effects
        this.distortion.init(ctx);

        // 3. Connect Graph: 
        // Voices -> DryBus -> Distortion -> Output(Master)
        this.dryBus.connect(this.distortion.getInput());
        this.distortion.connect(this.outputNode);
    }

    /**
     * Update Effects Parameters
     */
    setDistortion(amount) {
        if (this.distortion) {
            this.distortion.setDrive(amount);
        }
    }

    /**
     * Trigger a Note
     */
    play(note, octave, time, duration = 0.25, distortionAmount = 0) {
        if (!this.ctx) return;

        // Ensure distortion is synced with current step param
        // (In a future update, distortion could be per-step, or global)
        this.setDistortion(distortionAmount);

        // Frequencies Map
        const noteMap = {'C':0,'C#':1,'D':2,'D#':3,'E':4,'F':5,'F#':6,'G':7,'G#':8,'A':9,'A#':10,'B':11};
        const noteIndex = noteMap[note];
        if (noteIndex === undefined) return;

        // MIDI Formula
        const midiNote = (octave + 1) * 12 + noteIndex;
        const freq = 440 * Math.pow(2, (midiNote - 69) / 12);

        // --- VOICE CREATION (Monophonic instance) ---
        
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const filter = this.ctx.createBiquadFilter();
        
        // 1. OSCILLATOR
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, time);
        osc.detune.setValueAtTime((Math.random() * 8) - 4, time); // Organic drift

        // 2. FILTER
        filter.type = 'lowpass';
        // Dynamic cutoff based on settings + octave tracking
        const cutoff = this.settings.cutoffBase + (octave * 150);
        filter.frequency.setValueAtTime(cutoff, time);
        filter.Q.value = this.settings.resonance;
        // Filter Envelope (Wobble/Pluck)
        filter.frequency.exponentialRampToValueAtTime(80, time + duration);

        // 3. AMPLITUDE ENVELOPE (VCA)
        gain.gain.setValueAtTime(0, time);
        gain.gain.linearRampToValueAtTime(0.5, time + 0.015); // Fast Attack
        gain.gain.exponentialRampToValueAtTime(0.001, time + duration); // Decay

        // 4. CONNECT TO INTERNAL BUS
        // Instead of connecting to Master, we connect to this synth's dryBus
        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.dryBus); 

        // 5. START/STOP
        osc.start(time);
        osc.stop(time + duration + 0.1);

        // Cleanup
        osc.onended = () => {
            osc.disconnect();
            filter.disconnect();
            gain.disconnect();
        };
    }
}

// Default instance for compatibility with current Main.js
// In the future, main.js can instantiate: const bass2 = new BassSynth("Sub");
window.bassSynth = new BassSynth("MainBass");