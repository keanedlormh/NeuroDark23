/*
 * BASS FX CHAIN MODULE
 * Handles post-processing effects like Distortion.
 */

class BassFXChain {
    constructor(audioContext) {
        this.ctx = audioContext;
        this.input = this.ctx.createGain();
        this.output = this.ctx.createGain();
        
        // 1. Distortion Node
        this.shaper = this.ctx.createWaveShaper();
        this.shaper.oversample = '2x';
        
        // Routing: Input -> Shaper -> Output
        this.input.connect(this.shaper);
        this.shaper.connect(this.output);
        
        // Init Cache
        this.amount = 0;
        this.cachedCurve = null;
    }

    connect(destination) {
        this.output.connect(destination);
    }

    setDistortion(amount) {
        if (amount === this.amount && this.cachedCurve) return;
        this.amount = amount;
        
        if (amount <= 0) {
            this.shaper.curve = null;
        } else {
            // Lazy generate curve
            this.shaper.curve = this._makeDistortionCurve(amount);
        }
    }

    _makeDistortionCurve(amount) {
        const k = amount;
        const n_samples = 44100;
        const curve = new Float32Array(n_samples);
        const deg = Math.PI / 180;
        
        for (let i = 0; i < n_samples; ++i) {
            let x = i * 2 / n_samples - 1;
            curve[i] = (3 + k) * x * 20 * deg / (Math.PI + k * Math.abs(x));
        }
        return curve;
    }
}

// Export class globally
window.BassFXChain = BassFXChain;