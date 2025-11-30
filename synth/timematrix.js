/**
 * TIME MATRIX MODULE (Robust Version)
 * Handles grid rendering, state management, and visual feedback.
 */

class TimeMatrix {
    constructor(steps = 16) {
        this.totalSteps = steps;
        this.gridCols = 4;
        
        // Data Structure
        this.pattern = {
            bass: new Array(steps).fill(null),      // Format: { note: 'C', octave: 3 }
            drums: new Array(steps).fill().map(() => []) // Format: ['kick', 'snare']
        };
        
        this.selectedStep = 0;
        this.containerId = 'matrix-container'; 
        this.container = null;
    }

    /**
     * Initializes the matrix finding the DOM element.
     * Safe to call multiple times.
     */
    init() {
        this.container = document.getElementById(this.containerId);
        if (!this.container) {
            console.warn(`TimeMatrix: Container #${this.containerId} not found yet.`);
            return false;
        }
        return true;
    }

    /**
     * Updates the number of columns and redraws.
     */
    setGridColumns(cols) {
        this.gridCols = parseInt(cols);
        this.render();
    }

    /**
     * Returns the musical data for a specific step.
     * Used by the Audio Engine.
     */
    getStepData(index) {
        if (index < 0 || index >= this.totalSteps) return {};
        return {
            bass: this.pattern.bass[index],
            drums: this.pattern.drums[index] || []
        };
    }

    /**
     * Renders the entire grid into the container.
     */
    render(activeView = 'bass') {
        if (!this.init()) return; // Safety check

        this.container.innerHTML = '';
        this.container.style.gridTemplateColumns = `repeat(${this.gridCols}, minmax(0, 1fr))`;

        for (let i = 0; i < this.totalSteps; i++) {
            const el = document.createElement('div');
            el.className = 'step-box';
            
            // Highlight if selected
            if (i === this.selectedStep) {
                el.classList.add('step-selected');
            }

            // Draw content (Notes/Dots)
            this.drawStepContent(el, i, activeView);

            // Click Handler
            el.onclick = () => {
                // Dispatch custom event for Main Controller
                const event = new CustomEvent('stepSelect', { detail: { index: i } });
                window.dispatchEvent(event);
            };

            this.container.appendChild(el);
        }
    }

    /**
     * Helper to draw internal content of a step
     */
    drawStepContent(el, index, activeView) {
        const bass = this.pattern.bass[index];
        const drums = this.pattern.drums[index];

        if (activeView === 'bass') {
            if (bass) {
                el.classList.add('has-bass');
                el.innerHTML = `
                    <div class="flex flex-col items-center justify-center w-full h-full pointer-events-none">
                        <span class="text-xl font-bold tracking-tighter">${bass.note}</span>
                        <span class="text-[10px] opacity-60 font-mono">${bass.octave}</span>
                    </div>`;
            } else {
                el.classList.remove('has-bass');
                el.innerHTML = `<span class="text-[10px] text-gray-700 font-mono pointer-events-none">${index + 1}</span>`;
            }
        } else {
            // Drum View
            el.classList.remove('has-bass');
            if (drums && drums.length > 0) {
                let html = '<div class="flex flex-wrap gap-1 justify-center items-center w-full px-1 pointer-events-none">';
                // Access drumSynth kits safely if available, else use default colors
                const kits = window.drumSynth ? window.drumSynth.kits : [
                    {id:'kick', color:'red'}, {id:'snare', color:'yellow'}, {id:'hat', color:'cyan'}, {id:'perc', color:'purple'}
                ];

                kits.forEach(kit => {
                    if (drums.includes(kit.id)) {
                        html += `<div class="w-2 h-2 rounded-full shadow-[0_0_5px_${kit.color}]" style="background:${kit.color}"></div>`;
                    }
                });
                html += '</div>';
                el.innerHTML = html;
            } else {
                el.innerHTML = `<span class="text-[10px] text-gray-700 font-mono pointer-events-none">${index + 1}</span>`;
            }
        }
    }

    /**
     * Visual feedback for the playback cursor.
     * Called by the scheduler loop.
     */
    highlightPlayingStep(index) {
        if (!this.container && !this.init()) return;

        // 1. Remove old highlight
        const old = this.container.querySelector('.step-playing');
        if (old) old.classList.remove('step-playing');
        
        // 2. Add new highlight
        // Ensure index is within bounds to prevent crash
        if (index >= 0 && index < this.container.children.length) {
            const step = this.container.children[index];
            if (step) step.classList.add('step-playing');
        }
    }
}

// Initialize immediately so main.js can access window.timeMatrix
window.timeMatrix = new TimeMatrix();