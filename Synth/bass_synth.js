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
        // Inicializamos en una frecuencia baja audible para evitar rampas desde 0Hz
        this.lastFreq = 110.0; 
        
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

    play(note, octave, time, duration = 0.25, slide = false, accent = false) {
        if (!this.ctx) return;

        const noteMap = {'C':0,'C#':1,'D':2,'D#':3,'E':4,'F':5,'F#':6,'G':7,'G#':8,'A':9,'A#':10,'B':11};
        const noteIndex = noteMap[note];
        if (noteIndex === undefined) return;

        // Calcular frecuencia MIDI
        const midiNote = (octave + 1) * 12 + noteIndex;
        const freq = 440 * Math.pow(2, (midiNote - 69) / 12);

        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const filter = this.ctx.createBiquadFilter();

        // --- 1. OSCILADOR & PITCH (SLIDE LOGIC) ---
        osc.type = 'sawtooth';
        
        // Evitar errores si lastFreq no está definida
        if (!this.lastFreq) this.lastFreq = freq;

        if (slide) {
            // SLIDE ACTIVO:
            // Empezamos EXACTAMENTE en la frecuencia de la nota anterior
            osc.frequency.setValueAtTime(this.lastFreq, time);
            // Deslizamos EXPONENCIALMENTE hacia la nueva nota
            // Tiempo de slide: 60ms (típico 303) a 100ms. Probamos 0.1s para que sea notable.
            osc.frequency.exponentialRampToValueAtTime(freq, time + 0.12);
        } else {
            // NO SLIDE:
            // Ataque instantáneo en la nota correcta
            osc.frequency.setValueAtTime(freq, time);
        }
        
        // Guardar frecuencia para el próximo paso
        this.lastFreq = freq;

        // Detune ligero para grosor analógico
        osc.detune.setValueAtTime((Math.random() * 6) - 3, time); 

        // --- 2. FILTRO (ACCENT LOGIC) ---
        filter.type = 'lowpass';
        const baseCutoff = Math.max(100, this.params.cutoff); // Evitar 0Hz
        
        // Start Filter
        filter.frequency.setValueAtTime(baseCutoff, time);
        
        // ACCENT: Aumenta drásticamente la resonancia y la apertura del filtro
        // Si hay acento, el filtro "grita" más (Q más alto)
        const currentRes = this.params.resonance;
        filter.Q.value = accent ? Math.min(30, currentRes * 2.5 + 5) : currentRes;
        
        // Envolvente del Filtro
        // Si hay acento, el pico del filtro es más alto (más brillante) y decae más rápido (snap)
        const envAmount = accent ? 3500 : 1500;
        const decayTime = accent ? 0.15 : duration; // Accent suele ser más percusivo (decay corto)
        
        // Ataque del filtro: Si es slide, suavizamos un poco el ataque del filtro para mayor fluidez
        const attackTime = slide ? 0.08 : 0.03;

        filter.frequency.linearRampToValueAtTime(baseCutoff + envAmount, time + attackTime);
        filter.frequency.exponentialRampToValueAtTime(baseCutoff, time + attackTime + decayTime);

        // --- 3. AMPLIFICADOR (VOLUMEN) ---
        // ACCENT: Volumen pico más alto (0.9 vs 0.5)
        const peakGain = accent ? 0.9 : 0.5;

        // Manejo del ataque de volumen para el Slide
        gain.gain.setValueAtTime(0, time);
        
        if (slide) {
            // SLIDE: Ataque casi inmediato pero no 0, para simular que el sonido continua
            // Esto evita el "hueco" de silencio entre notas ligadas
            gain.gain.linearRampToValueAtTime(peakGain, time + 0.005);
            // Sustain un poco más alto durante el slide
            gain.gain.exponentialRampToValueAtTime(0.1, time + duration);
        } else {
            // NORMAL: Ataque estándar (punchy)
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

        // Start/Stop
        osc.start(time);
        // Dejamos un poco de cola (release) para evitar clicks al cortar
        osc.stop(time + duration + 0.1);

        // Limpieza de memoria
        osc.onended = () => {
            osc.disconnect();
            gain.disconnect();
            filter.disconnect();
        };
    }
}

window.BassSynth = BassSynth;