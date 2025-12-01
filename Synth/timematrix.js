/**
 * TIME MATRIX MODULE (Multi-Track Edition)
 * Data Structure:
 * Block {
 * tracks: { 'bass-1': [notes...], 'bass-2': [notes...] },
 * drums: [ ... ]
 * }
 */

class TimeMatrix {
    constructor(steps = 16) {
        this.totalSteps = steps;
        this.gridCols = 4;
        this.blocks = [];
        this.containerId = 'matrix-container'; 
        this.container = null;
        
        // Initial Block
        this.addBlock();
    }

    init() {
        this.container = document.getElementById(this.containerId);
        return !!this.container;
    }

    // --- TRACK MANAGEMENT ---

    /**
     * Ensures all blocks have a data array for the given synth ID
     */
    registerTrack(synthId) {
        this.blocks.forEach(block => {
            if (!block.tracks[synthId]) {
                block.tracks[synthId] = new Array(this.totalSteps).fill(null);
            }
        });
    }

    removeTrack(synthId) {
        this.blocks.forEach(block => {
            delete block.tracks[synthId];
        });
    }

    // --- BLOCK MANAGEMENT ---

    addBlock() {
        // Create new block with empty tracks for all known synths
        // We look at the first block to see what tracks exist, or start empty
        const knownTracks = this.blocks.length > 0 ? Object.keys(this.blocks[0].tracks) : ['bass-1'];
        
        const newTracks = {};
        knownTracks.forEach(id => {
            newTracks[id] = new Array(this.totalSteps).fill(null);
        });

        this.blocks.push({
            tracks: newTracks,
            drums: new Array(this.totalSteps).fill().map(() => [])
        });
    }

    removeBlock(index) {
        if (this.blocks.length <= 1) {
            this.clearBlock(0);
            return;
        }
        this.blocks.splice(index, 1);
    }

    clearBlock(index) {
        const block = this.blocks[index];
        if (!block) return;
        
        // Clear all tracks
        Object.keys(block.tracks).forEach(key => {
            block.tracks[key].fill(null);
        });
        // Clear drums
        block.drums.forEach(d => d.length = 0);
    }

    // --- DATA ACCESS ---

    /**
     * Get data for AUDIO playhead
     */
    getStepData(stepIndex, blockIndex) {
        if (blockIndex < 0 || blockIndex >= this.blocks.length) return {};
        const block = this.blocks[blockIndex];
        
        // Return drums and ALL tracks
        return {
            tracks: block.tracks, // { 'bass-1': Note, 'bass-2': Note ... }
            drums: block.drums[stepIndex] || []
        };
    }

    /**
     * Get data for VISUAL editor (Specific Synth)
     */
    getEditorData(stepIndex, blockIndex, activeView) {
        if (blockIndex < 0 || blockIndex >= this.blocks.length) return null;
        const block = this.blocks[blockIndex];
        
        if (activeView === 'drum') {
            return block.drums[stepIndex];
        } else {
            // Assume activeView is a synth ID (e.g., 'bass-1')
            return block.tracks[activeView] ? block.tracks[activeView][stepIndex] : null;
        }
    }

    // --- RENDERING ---

    render(activeView, blockIndex) {
        if (!this.init()) return;

        this.container.innerHTML = '';
        this.container.style.gridTemplateColumns = `repeat(${this.gridCols}, minmax(0, 1fr))`;
        
        const block = this.blocks[blockIndex];
        if (!block) return;

        for (let i = 0; i < this.totalSteps; i++) {
            const el = document.createElement('div');
            el.className = 'step-box';
            
            // Draw content based on Active View (Synth ID or 'drum')
            if (activeView === 'drum') {
                this.drawDrums(el, block.drums[i]);
            } else {
                // It's a Synth Track
                const trackData = block.tracks[activeView];
                // Ensure track exists, otherwise register it just in case
                if (!trackData) {
                    this.registerTrack(activeView);
                    this.drawNote(el, null);
                } else {
                    this.drawNote(el, trackData[i]);
                }
            }

            el.onclick = () => {
                const event = new CustomEvent('stepSelect', { detail: { index: i } });
                window.dispatchEvent(event);
            };

            this.container.appendChild(el);
        }
    }

    drawNote(el, noteData) {
        if (noteData) {
            el.classList.add('has-bass');
            el.innerHTML = `
                <div class="flex flex-col items-center justify-center w-full h-full pointer-events-none">
                    <span class="text-xl font-bold tracking-tighter">${noteData.note}</span>
                    <span class="text-[10px] opacity-60 font-mono">${noteData.octave}</span>
                </div>`;
        } else {
            el.classList.remove('has-bass');
            // Show number (index+1)
            el.innerHTML = `<span class="text-[10px] text-gray-700 font-mono pointer-events-none">${Array.prototype.indexOf.call(el.parentNode.children, el) + 1}</span>`;
        }
    }

    drawDrums(el, drums) {
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
            el.innerHTML = `<span class="text-[10px] text-gray-700 font-mono pointer-events-none">${Array.prototype.indexOf.call(el.parentNode.children, el) + 1}</span>`;
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