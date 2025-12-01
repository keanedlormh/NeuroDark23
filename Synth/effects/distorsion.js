/**
 * DISTORTION EFFECT MODULE
 * Independent DSP unit for WaveShaping distortion.
 */

class DistortionEffect {
    constructor() {
        this.ctx = null;
        this.input = null;  // Node to connect signals INTO
        this.output = null; // Node to connect output FROM
        this.shaper = null;
        this.amount = 0;
        this.cachedCurve = null;
        this.bypass = false;
    }

    /**
     * Initialize the audio nodes
     * @param {AudioContext} ctx 
     */
    init(ctx) {
        this.ctx = ctx;
        
        // Create nodes
        this.input = ctx.createGain();
        this.output = ctx.createGain();
        this.shaper = ctx.createWaveShaper();
        
        // Default routing: Input -> Shaper -> Output
        this.shaper.oversample = '2x'; // Balance quality/performance
        this.input.connect(this.shaper);
        this.shaper.connect(this.output);

        // Calculate initial curve (clean)
        this.setDrive(0);
    }

    /**
     * Connect this effect to the next node in the chain
     */
    connect(destination) {
        this.output.connect(destination);
    }

    /**
     * Returns the input node (so synths can connect TO this effect)
     */
    getInput() {
        return this.input;
    }

    /**
     * Sets the distortion amount (0 - 100)
     */
    setDrive(amount) {
        // Optimization: Don't recalculate if same value
        if (amount === this.amount && this.cachedCurve) return;

        this.amount = amount;
        
        if (amount <= 0) {
            // If 0, bypass the math logic via a linear curve or disconnect logic
            // Simple approach: linear curve
            this.shaper.curve = null; 
        } else {
            this.shaper.curve = this._makeDistortionCurve(amount);
        }
    }

    /**
     * Internal Math for Sigmoid Distortion
     */
    _makeDistortionCurve(amount) {
        const k = amount; // 0 to 100+
        const n_samples = 22050; 
        const curve = new Float32Array(n_samples);
        const deg = Math.PI / 180;
        
        for (let i = 0; i < n_samples; ++i) {
            let x = i * 2 / n_samples - 1;
            // Standard Web Audio sigmoid distortion algorithm
            curve[i] = (3 + k) * x * 20 * deg / (Math.PI + k * Math.abs(x));
        }
        return curve;
    }
}