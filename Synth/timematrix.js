/**
 * TIME MATRIX MODULE (v23 Grid Control)
 */

class TimeMatrix {
    constructor(steps = 16) {
        this.totalSteps = steps;
        this.gridCols = 4; // Default
        this.blocks = [];
        this.containerId = 'matrix-container'; 
        this.selectedStep = 0; // Track selected step internally
        this.addBlock();
    }

    // --- VIEW CONTROL ---
    setGridColumns(cols) {
        this.gridCols = parseInt(cols);
        // Force re-render of current view
        // Note: The render method is called by main.js, this just updates state
    }

    // --- DATA ---
    addBlock() {
        const newTracks = { 'bass-1': new Array(this.totalSteps).fill(null) };
        if (this.blocks.length > 0) Object.keys(this.blocks[0].tracks).forEach(k => newTracks[k] = new Array(this.totalSteps).fill(null));
        this.blocks.push({ tracks: newTracks, drums: new Array(this.totalSteps).fill().map(()=>[]) });
    }

    duplicateBlock(idx) {
        if(!this.blocks[idx]) return;
        const org = this.blocks[idx];
        const newTracks = {};
        Object.keys(org.tracks).forEach(k => newTracks[k] = [...org.tracks[k]]);
        this.blocks.splice(idx+1, 0, { tracks: newTracks, drums: org.drums.map(d=>[...d]) });
    }

    removeBlock(idx) { if(this.blocks.length<=1) this.clearBlock(0); else this.blocks.splice(idx,1); }
    moveBlock(idx, dir) {
        const t = idx + dir;
        if(t<0 || t>=this.blocks.length) return false;
        const tmp = this.blocks[t]; this.blocks[t] = this.blocks[idx]; this.blocks[idx] = tmp;
        return true;
    }
    clearBlock(idx) {
        const b = this.blocks[idx];
        if(!b) return;
        Object.keys(b.tracks).forEach(k=>b.tracks[k].fill(null));
        b.drums.forEach(d=>d.length=0);
    }
    registerTrack(id) { this.blocks.forEach(b=>{ if(!b.tracks[id]) b.tracks[id] = new Array(this.totalSteps).fill(null); }); }
    removeTrack(id) { this.blocks.forEach(b=>delete b.tracks[id]); }
    
    getStepData(step, block) {
        const b = this.blocks[block];
        if(!b) return {};
        return { tracks: b.tracks, drums: b.drums[step]||[] };
    }

    // --- RENDER ---
    init() { this.container = document.getElementById(this.containerId); return !!this.container; }

    render(activeView, blockIndex) {
        if (!this.init()) return;
        this.container.innerHTML = '';
        this.container.style.gridTemplateColumns = `repeat(${this.gridCols}, minmax(0, 1fr))`;
        
        const block = this.blocks[blockIndex];
        if (!block) return;

        for (let i = 0; i < this.totalSteps; i++) {
            const el = document.createElement('div');
            el.className = 'step-box';
            
            // --- FIX: Apply selected class if index matches selectedStep ---
            if (i === this.selectedStep) {
                el.classList.add('step-selected');
            }
            // -------------------------------------------------------------

            if (activeView === 'drum') this.drawDrums(el, block.drums[i]);
            else {
                if(!block.tracks[activeView]) this.registerTrack(activeView);
                this.drawNote(el, block.tracks[activeView][i], i);
            }

            el.onclick = () => {
                const event = new CustomEvent('stepSelect', { detail: { index: i } });
                window.dispatchEvent(event);
            };
            this.container.appendChild(el);
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
            const kits = (window.drumSynth && window.drumSynth.kits) ? window.drumSynth.kits : [];
            drums.forEach(id => {
                const k = kits.find(x=>x.id===id);
                const c = k ? k.color : '#fff';
                html += `<div class="w-2 h-2 rounded-full shadow-[0_0_5px_${c}]" style="background:${c}"></div>`;
            });
            el.innerHTML = html + '</div>';
        } else {
            el.innerHTML = `<span class="text-[10px] text-gray-700 font-mono pointer-events-none">.</span>`;
        }
    }

    highlightPlayingStep(index) {
        if (!this.init()) return;
        const old = this.container.querySelector('.step-playing');
        if (old) old.classList.remove('step-playing');
        if (index >= 0 && this.container.children[index]) {
            this.container.children[index].classList.add('step-playing');
        }
    }
}

window.timeMatrix = new TimeMatrix();