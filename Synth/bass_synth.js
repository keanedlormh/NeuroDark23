/*
 * BASS SYNTH MODULE (Acid Edition)
 * Optimized for Slide (Legato) and Accent emulation.
 */

class BassSynth {
    constructor(id = 'bass-1') {
        this.id = id;
        this.ctx = null;
        this.output = null;
        this.fxChain = null;
        
        // Estado interno para el Portamento (Slide)
        this.lastFreq = 110.0; 
        
        this.params = {
            distortion: 20,
            cutoff: 800,
            resonance: 4,
            waveform: 'sawtooth' // 'sawtooth' or 'square'
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
    setWaveform(val) { this.params.waveform = val; } // Nueva función

    play(note, octave, time, duration = 0.25, slide = false, accent = false) {
        if (!this.ctx) return;

        const noteMap = {'C':0,'C#':1,'D':2,'D#':3,'E':4,'F':5,'F#':6,'G':7,'G#':8,'A':9,'A#':10,'B':11};
        const noteIndex = noteMap[note];
        if (noteIndex === undefined) return;

        const midiNote = (octave + 1) * 12 + noteIndex;
        const freq = 440 * Math.pow(2, (midiNote - 69) / 12);

        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const filter = this.ctx.createBiquadFilter();

        // --- 1. OSCILADOR & WAVEFORM ---
        // APLICAR FORMA DE ONDA SELECCIONADA
        osc.type = this.params.waveform; 
        
        if (!this.lastFreq) this.lastFreq = freq;

        if (slide) {
            osc.frequency.setValueAtTime(this.lastFreq, time);
            osc.frequency.exponentialRampToValueAtTime(freq, time + 0.12);
        } else {
            osc.frequency.setValueAtTime(freq, time);
        }
        
        this.lastFreq = freq;
        osc.detune.setValueAtTime((Math.random() * 6) - 3, time); 

        // --- 2. FILTRO ---
        filter.type = 'lowpass';
        const baseCutoff = Math.max(100, this.params.cutoff);
        
        filter.frequency.setValueAtTime(baseCutoff, time);
        
        const currentRes = this.params.resonance;
        filter.Q.value = accent ? Math.min(30, currentRes * 2.5 + 5) : currentRes;
        
        const envAmount = accent ? 3500 : 1500;
        const decayTime = accent ? 0.15 : duration; 
        const attackTime = slide ? 0.08 : 0.03;

        filter.frequency.linearRampToValueAtTime(baseCutoff + envAmount, time + attackTime);
        filter.frequency.exponentialRampToValueAtTime(baseCutoff, time + attackTime + decayTime);

        // --- 3. AMPLIFICADOR ---
        const peakGain = accent ? 0.9 : 0.5;

        gain.gain.setValueAtTime(0, time);
        
        if (slide) {
            gain.gain.linearRampToValueAtTime(peakGain, time + 0.005);
            gain.gain.exponentialRampToValueAtTime(0.1, time + duration);
        } else {
            gain.gain.linearRampToValueAtTime(peakGain, time + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
        }

        // --- RUTEO ---
        osc.connect(filter);
        filter.connect(gain);
        
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