/**
 * TIME MATRIX MODULE (Multi-Block Support)
 */

class TimeMatrix {
    constructor(steps = 16) {
        this.totalSteps = steps;
        this.gridCols = 4;
        
        // Array of Blocks (Song Structure)
        // Each block contains { bass: [], drums: [] }
        this.blocks = [];
        
        // Initialize with one empty block
        this.addBlock();
        
        this.selectedStep = 0;
        this.containerId = 'matrix-container'; 
        this.container = null;
    }

    init() {
        this.container = document.getElementById(this.containerId);
        return !!this.container;
    }

    addBlock() {
        this.blocks.push({
            bass: new Array(this.totalSteps).fill(null),
            drums: new Array(this.totalSteps).fill().map(() => [])
        });
    }

    duplicateBlock(index) {
        if (index < 0 || index >= this.blocks.length) return;
        
        // Deep copy of the block
        const original = this.blocks[index];
        const newBlock = {
            bass: [...original.bass], // Copy bass array (objects inside are simple, but be careful if they become complex)
            drums: original.drums.map(d => [...d]) // Deep copy of drums arrays
        };
        
        // Insert after current
        this.blocks.splice(index + 1, 0, newBlock);
    }

    removeBlock(index) {
        if (this.blocks.length <= 1) {
            // If only one block, just clear it
            this.clearBlock(0);
            return;
        }
        this.blocks.splice(index, 1);
    }

    clearBlock(index) {
        if (index < 0 || index >= this.blocks.length) return;
        this.blocks[index].bass.fill(null);
        this.blocks[index].drums.forEach(d => d.length = 0);
    }

    /**
     * Get data for AUDIO engine (Playhead)
     */
    getStepData(stepIndex, blockIndex) {
        if (blockIndex < 0 || blockIndex >= this.blocks.length) return {};
        
        const block = this.blocks[blockIndex];
        return {
            bass: block.bass[stepIndex],
            drums: block.drums[stepIndex] || []
        };
    }

    /**
     * Render data for VISUAL editor (Editing Block)
     */
    render(activeView = 'bass', blockIndex = 0) {
        if (!this.init()) return;

        this.container.innerHTML = '';
        this.container.style.gridTemplateColumns = `repeat(${this.gridCols}, minmax(0, 1fr))`;
        
        const block = this.blocks[blockIndex];
        if (!block) return; // Safety

        for (let i = 0; i < this.totalSteps; i++) {
            const el = document.createElement('div');
            el.className = 'step-box';
            
            if (i === this.selectedStep) el.classList.add('step-selected');

            this.drawStepContent(el, i, activeView, block);

            el.onclick = () => {
                const event = new CustomEvent('stepSelect', { detail: { index: i } });
                window.dispatchEvent(event);
            };

            this.container.appendChild(el);
        }
    }

    drawStepContent(el, index, activeView, block) {
        const bass = block.bass[index];
        const drums = block.drums[index];

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
                const kits = window.drumSynth ? window.drumSynth.kits : [];
                
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

    highlightPlayingStep(index) {
        if (!this.container && !this.init()) return;
        
        const old = this.container.querySelector('.step-playing');
        if (old) old.classList.remove('step-playing');
        
        if (index >= 0 && index < this.container.children.length) {
            this.container.children[index].classList.add('step-playing');
        }
    }
}

window.timeMatrix = new TimeMatrix();