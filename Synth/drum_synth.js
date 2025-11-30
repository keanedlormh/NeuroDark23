/* * DRUM SYNTH MODULE
 * Synthesizes percussive sounds from scratch (no samples).
 */

class DrumSynth {
    constructor() {
        this.ctx = null;
        this.masterGain = null;
        
        this.kits = [
            { id: 'kick', name: 'KICK', color: '#ff2222' },
            { id: 'snare', name: 'SNARE', color: '#ffdd00' },
            { id: 'hat', name: 'HI-HAT', color: '#00ccff' },
            { id: 'perc', name: 'GLITCH', color: '#aa00ff' }
        ];
    }

    init(audioContext, outputNode) {
        this.ctx = audioContext;
        this.masterGain = outputNode;
    }

    play(type, time) {
        if (!this.ctx) return;

        switch (type) {
            case 'kick': this.playKick(time); break;
            case 'snare': this.playSnare(time); break;
            case 'hat': this.playHat(time); break;
            case 'perc': this.playPerc(time); break;
        }
    }

    playKick(time) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

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
        // White Noise Source
        const bufferSize = this.ctx.sampleRate * 0.5;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }

        const noise = this.ctx.createBufferSource();
        noise.buffer = buffer;

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.setValueAtTime(1000, time);

        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.5, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.2);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(this.masterGain);

        noise.start(time);
        noise.stop(time + 0.2);
    }

    playHat(time) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const filter = this.ctx.createBiquadFilter();

        // Metallic Square Wave
        osc.type = 'square';
        osc.frequency.setValueAtTime(800, time);
        // Random pitch for variety
        osc.detune.value = Math.random() * 1000;

        filter.type = 'highpass';
        filter.frequency.setValueAtTime(5000, time);

        gain.gain.setValueAtTime(0.15, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.05);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.masterGain);

        osc.start(time);
        osc.stop(time + 0.1);
    }

    playPerc(time) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.frequency.setValueAtTime(800, time);
        osc.frequency.linearRampToValueAtTime(100, time + 0.1);

        gain.gain.setValueAtTime(0.3, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.1);

        osc.connect(gain);
        gain.connect(this.masterGain);

        osc.start(time);
        osc.stop(time + 0.1);
    }
}

window.drumSynth = new DrumSynth();
