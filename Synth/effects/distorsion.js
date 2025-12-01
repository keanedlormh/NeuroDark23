/*
 * EFFECT MODULE: DISTORTION
 * Provides a WaveShaper node with caching for efficiency.
 */

class DistortionEffect {
    constructor(audioContext) {
        this.ctx = audioContext;
        this.input = this.ctx.createGain(); // Input node
        this.output = this.ctx.createGain(); // Output node
        this.shaper = this.ctx.createWaveShaper();
        
        // Config
        this.shaper.oversample = '4x';
        this.amount = 0;
        this.cachedCurve = null;

        // Routing: Input -> Shaper -> Output
        this.input.connect(this.shaper);
        this.shaper.connect(this.output);
    }

    /**
     * Connect this effect to a destination
     */
    connect(destination) {
        this.output.connect(destination);
    }

    /**
     * Set distortion amount (0-100)
     */
    setAmount(val) {
        if (val === this.amount && this.cachedCurve) return; // No change
        
        this.amount = val;
        
        if (val <= 0) {
            this.shaper.curve = null; // Bypass calculation
            return;
        }

        this.shaper.curve = this._makeDistortionCurve(val);
    }

    /**
     * Internal curve generator
     */
    _makeDistortionCurve(amount) {
        const k = typeof amount === 'number' ? amount : 50;
        const n_samples = 22050; 
        const curve = new Float32Array(n_samples);
        const deg = Math.PI / 180;
        
        for (let i = 0; i < n_samples; ++i) {
            let x = i * 2 / n_samples - 1;
            curve[i] = (3 + k) * x * 20 * deg / (Math.PI + k * Math.abs(x));
        }
        return curve;
    }
}