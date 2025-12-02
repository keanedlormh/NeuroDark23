/**
 * TIME MATRIX MODULE (Sequence Control)
 */

class TimeMatrix {
    constructor(steps = 16) {
        this.totalSteps = steps;
        this.gridCols = 4;
        this.blocks = [];
        this.containerId = 'matrix-container'; 
        
        this.addBlock();
        if(window.logToScreen) window.logToScreen("TimeMatrix Ready");
    }

    // --- DATA ---
    addBlock() {
        const newTracks = { 'bass-1': new Array(this.totalSteps).fill(null) };
        if (this.blocks.length > 0) {
            Object.keys(this.blocks[0].tracks).forEach(k => {
                newTracks[k] = new Array(this.totalSteps).fill(null);
            });
        }
        this.blocks.push({
            tracks: newTracks,
            drums: new Array(this.totalSteps).fill().map(() => [])
        });
    }

    duplicateBlock(idx) {
        if(!this.blocks[idx]) return;
        const org = this.blocks[idx];
        const newTracks = {};
        Object.keys(org.tracks).forEach(k => {
            // Deep copy of notes
            newTracks[k] = org.tracks[k].map(n => n ? {...n} : null);
        });
        this.blocks.splice(idx+1, 0, { 
            tracks: newTracks, 
            drums: org.drums.map(d=>[...d]) 
        });
    }

    removeBlock(idx) {
        if(this.blocks.length <= 1) return this.clearBlock(0);
        this.blocks.splice(idx, 1);
    }

    moveBlock(idx, direction) {
        const targetIdx = idx + direction;
        // Bounds check
        if (targetIdx < 0 || targetIdx >= this.blocks.length) return false;
        
        // Swap
        const temp = this.blocks[targetIdx];
        this.blocks[targetIdx] = this.blocks[idx];
        this.blocks[idx] = temp;
        return true; // Success
    }

    clearBlock(idx) {
        const b = this.blocks[idx];
        if(!b) return;
        Object.keys(b.tracks).forEach(k => b.tracks[k].fill(null));
        b.drums.forEach(d => d.length = 0);
    }

    registerTrack(id) {
        this.blocks.forEach(b => { if (!b.tracks[id]) b.tracks[id] = new Array(this.totalSteps).fill(null); });
    }
    removeTrack(id) { this.blocks.forEach(b => delete b.tracks[id]); }

    getStepData(step, blockIdx) {
        const b = this.blocks[blockIdx];
        if(!b) return {};
        return { tracks: b.tracks, drums: b.drums[step] || [] };
    }

    // --- RENDER ---
    render(activeView, blockIdx) {
        const container = document.getElementById(this.containerId);
        if(!container) return;

        container.innerHTML = '';
        container.style.gridTemplateColumns = `repeat(${this.gridCols}, minmax(0, 1fr))`;

        const block = this.blocks[blockIdx];
        if(!block) return;

        for(let i=0; i<this.totalSteps; i++) {
            const el = document.createElement('div');
            el.className = 'step-box';
            
            if(activeView === 'drum') {
                this.drawDrums(el, block.drums[i]);
            } else {
                if(!block.tracks[activeView]) this.registerTrack(activeView);
                this.drawNote(el, block.tracks[activeView][i], i);
            }

            el.onclick = () => {
                const event = new CustomEvent('stepSelect', { detail: { index: i } });
                window.dispatchEvent(event);
            };
            container.appendChild(el);
        }
    }

    drawNote(el, data, i) {
        if(data) {
            el.classList.add('has-bass');
            el.innerHTML = `<div class="flex flex-col items-center pointer-events-none"><span class="text-xl font-bold">${data.note}</span><span class="text-[10px] opacity-70">${data.octave}</span></div>`;
        } else {
            el.classList.remove('has-bass');
            el.innerHTML = `<span class="text-[10px] text-gray-700 font-mono pointer-events-none">${i+1}</span>`;
        }
    }

    drawDrums(el, drums) {
        el.classList.remove('has-bass');
        if(drums && drums.length) {
            let html = '<div class="flex flex-wrap gap-1 justify-center px-1 pointer-events-none">';
            const colors = {'kick':'#ff2222', 'snare':'#ffdd00', 'hat':'#00ccff', 'tom':'#bd00ff'};
            drums.forEach(id => {
                const col = (window.drumSynth && window.drumSynth.kits.find(k=>k.id===id)?.color) || colors[id] || '#fff';
                html += `<div class="w-2 h-2 rounded-full shadow-[0_0_5px_${col}]" style="background:${col}"></div>`;
            });
            el.innerHTML = html + '</div>';
        } else {
            el.innerHTML = `<span class="text-[10px] text-gray-700 font-mono pointer-events-none">.</span>`;
        }
    }

    highlightPlayingStep(index) {
        const container = document.getElementById(this.containerId);
        if(!container) return;
        const old = container.querySelector('.step-playing');
        if(old) old.classList.remove('step-playing');
        if(index >= 0 && container.children[index]) {
            container.children[index].classList.add('step-playing');
        }
    }
}

window.timeMatrix = new TimeMatrix();