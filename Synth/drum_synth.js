/* * DRUM SYNTH MODULE (Classic Kit Edition)
 * Synthesizes analog-style percussion.
 * * Techniques:
 * - Kick/Tom: Pitch-sweeping Sine/Triangle waves.
 * - Snare: Mixed Oscillator (body) + Filtered Noise (snares).
 * - HiHat: High-pass Filtered Noise (metallic spectrum).
 */

class DrumSynth {
    constructor() {
        this.ctx = null;
        this.masterGain = null;
        
        // Define the Kit
        this.kits = [
            { id: 'kick', name: 'KICK', color: '#ff2222' },   // Red
            { id: 'snare', name: 'SNARE', color: '#ffdd00' }, // Yellow
            { id: 'hat', name: 'HI-HAT', color: '#00ccff' },  // Cyan
            { id: 'tom', name: 'LOW TOM', color: '#bd00ff' }  // Purple (Replaces Glitch)
        ];
        
        // Cache noise buffer to save CPU
        this.noiseBuffer = null;
    }

    init(audioContext, outputNode) {
        this.ctx = audioContext;
        this.masterGain = outputNode;
        this.createNoiseBuffer();
    }

    // Pre-generate 1 second of white noise
    createNoiseBuffer() {
        if (!this.ctx) return;
        const bufferSize = this.ctx.sampleRate; 
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }
        this.noiseBuffer = buffer;
    }

    play(type, time) {
        if (!this.ctx) return;

        switch (type) {
            case 'kick': this.playKick(time); break;
            case 'snare': this.playSnare(time); break;
            case 'hat': this.playHiHat(time); break;
            case 'tom': this.playTom(time); break;
            // Legacy support if 'perc' ID remains in old patterns
            case 'perc': this.playTom(time); break; 
        }
    }

    playKick(time) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        // Punchier Kick
        osc.frequency.setValueAtTime(150, time);
        osc.frequency.exponentialRampToValueAtTime(0.01, time + 0.5);

        gain.gain.setValueAtTime(1, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.5);

        osc.connect(gain);
        gain.connect(this.masterGain);

        osc.start(time);
        osc.stop(time + 0.5);
    }

    playSnare(time) {
        // 1. Body (Tone)
        const osc = this.ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(180, time); // Slightly lower fundamental
        const oscGain = this.ctx.createGain();
        oscGain.gain.setValueAtTime(0.4, time);
        oscGain.gain.exponentialRampToValueAtTime(0.01, time + 0.15);
        osc.connect(oscGain);
        oscGain.connect(this.masterGain);
        osc.start(time);
        osc.stop(time + 0.2);

        // 2. Snares (Noise)
        const noise = this.ctx.createBufferSource();
        noise.buffer = this.noiseBuffer;
        
        const noiseFilter = this.ctx.createBiquadFilter();
        noiseFilter.type = 'highpass';
        noiseFilter.frequency.setValueAtTime(2000, time); // Cleaner snap

        const noiseGain = this.ctx.createGain();
        noiseGain.gain.setValueAtTime(0.6, time);
        noiseGain.gain.exponentialRampToValueAtTime(0.01, time + 0.25); // Snappier decay

        noise.connect(noiseFilter);
        noiseFilter.connect(noiseGain);
        noiseGain.connect(this.masterGain);
        
        noise.start(time);
        noise.stop(time + 0.3);
    }

    playHiHat(time) {
        // Classic Analog Closed Hat (Filtered Noise)
        const source = this.ctx.createBufferSource();
        source.buffer = this.noiseBuffer;

        // Bandpass to focus the metallic "chick" sound
        const bandpass = this.ctx.createBiquadFilter();
        bandpass.type = 'bandpass';
        bandpass.frequency.value = 10000;
        bandpass.Q.value = 1;

        // Highpass to remove any low rumble
        const highpass = this.ctx.createBiquadFilter();
        highpass.type = 'highpass';
        highpass.frequency.value = 7000;

        const gain = this.ctx.createGain();
        // Very sharp attack and decay
        gain.gain.setValueAtTime(0.6, time); 
        gain.gain.exponentialRampToValueAtTime(0.01, time + 0.08); // Short & crisp

        source.connect(bandpass);
        bandpass.connect(highpass);
        highpass.connect(gain);
        gain.connect(this.masterGain);

        source.start(time);
        source.stop(time + 0.1);
    }

    playTom(time) {
        // Classic Low/Mid Tom
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        // Pitch Sweep: Starts mid-low, drops low
        osc.frequency.setValueAtTime(200, time); 
        osc.frequency.exponentialRampToValueAtTime(60, time + 0.4);

        // Amplitude Envelope
        gain.gain.setValueAtTime(0.8, time);
        gain.gain.exponentialRampToValueAtTime(0.01, time + 0.4);

        osc.connect(gain);
        gain.connect(this.masterGain);

        osc.start(time);
        osc.stop(time + 0.4);
    }
}

// Instance
window.drumSynth = new DrumSynth();