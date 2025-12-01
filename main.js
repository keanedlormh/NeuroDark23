/*
 * NEURODARK MAIN CONTROLLER v12 (Stable Init)
 */

// STATE
const AppState = {
    isPlaying: false,
    bpm: 174,
    currentPlayStep: 0,
    currentPlayBlock: 0,
    editingBlock: 0,
    selectedStep: 0,
    activeView: 'bass-1', 
    currentOctave: 3,
    distortionLevel: 20,
    panelMode: 'docked',
    trackEditMode: false
};

// AUDIO GLOBALS
let audioCtx = null;
let masterGain = null;
let clockWorker = null;
let bassSynths = [];

// SCHEDULING
let nextNoteTime = 0.0;
const SCHEDULE_AHEAD_TIME = 0.1;
const LOOKAHEAD_INTERVAL = 25;

let visualQueue = [];
let drawFrameId = null;
let lastDrawnStep = -1;

// --- INIT ---

function initEngine() {
    // Si el contexto existe y funciona, no reiniciamos, solo reanudamos
    if (audioCtx && audioCtx.state === 'running') return;

    try {
        if (!audioCtx) {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            audioCtx = new AudioContext({ latencyHint: 'interactive' });
            
            masterGain = audioCtx.createGain();
            masterGain.gain.value = 0.6;
            
            const limiter = audioCtx.createDynamicsCompressor();
            limiter.threshold.value = -2;
            limiter.ratio.value = 16;
            masterGain.connect(limiter);
            limiter.connect(audioCtx.destination);

            // Init Synths
            if (bassSynths.length === 0) {
                // Crear Bass-1 por defecto si no existe
                addBassSynth('bass-1', false); 
            } else {
                bassSynths.forEach(s => s.init(audioCtx, masterGain));
            }

            if(window.drumSynth) window.drumSynth.init(audioCtx, masterGain);

            // Worker
            if (!clockWorker) {
                // Ruta relativa: asume que clock_worker.js está en Synth/
                clockWorker = new Worker('Synth/clock_worker.js');
                clockWorker.onmessage = (e) => { if (e.data === "tick") scheduler(); };
                clockWorker.postMessage({ interval: LOOKAHEAD_INTERVAL });
            }
            
            console.log("Audio Engine: ONLINE");
        }
    } catch(e) {
        console.error("Init Error:", e);
    }

    if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
}

// Global unlocker
function globalUnlock() {
    initEngine();
    if (audioCtx && audioCtx.state === 'running') {
        document.removeEventListener('click', globalUnlock);
        document.removeEventListener('touchstart', globalUnlock);
    }
}

// --- SYNTH MANAGER ---

function addBassSynth(customId = null, shouldRender = true) {
    const id = customId || `bass-${bassSynths.length + 1}`;
    if (bassSynths.find(s => s.id === id)) return;

    const newSynth = new BassSynth(id);
    if (audioCtx) newSynth.init(audioCtx, masterGain);
    
    bassSynths.push(newSynth);
    
    if(window.timeMatrix) window.timeMatrix.registerTrack(id);

    if (shouldRender) {
        renderSynthMenu();
        renderInstrumentTabs();
        setTab(id);
    }
}

function removeBassSynth(id) {
    if (bassSynths.length <= 1) {
        alert("Must have at least one synth.");
        return;
    }
    if (confirm(`Remove ${id}?`)) {
        bassSynths = bassSynths.filter(s => s.id !== id);
        window.timeMatrix.removeTrack(id);
        if (AppState.activeView === id) AppState.activeView = bassSynths[0].id;
        
        renderSynthMenu();
        renderInstrumentTabs();
        updateEditors();
    }
}

function getActiveSynth() {
    return bassSynths.find(s => s.id === AppState.activeView);
}

// --- SCHEDULER ---

function nextNote() {
    const secondsPerBeat = 60.0 / AppState.bpm;
    const secondsPerStep = secondsPerBeat / 4; 
    nextNoteTime += secondsPerStep;
    
    AppState.currentPlayStep++;
    if (AppState.currentPlayStep >= window.timeMatrix.totalSteps) {
        AppState.currentPlayStep = 0;
        AppState.currentPlayBlock++;
        if (AppState.currentPlayBlock >= window.timeMatrix.blocks.length) {
            AppState.currentPlayBlock = 0;
        }
    }
}

function scheduleNote(stepNumber, blockIndex, time) {
    visualQueue.push({ step: stepNumber, block: blockIndex, time: time });
    const data = window.timeMatrix.getStepData(stepNumber, blockIndex);

    if (data.drums && window.drumSynth) {
        data.drums.forEach(id => window.drumSynth.play(id, time));
    }

    if (data.tracks) {
        Object.keys(data.tracks).forEach(trackId => {
            const noteData = data.tracks[trackId][stepNumber];
            if (noteData) {
                const synth = bassSynths.find(s => s.id === trackId);
                if (synth) synth.play(noteData.note, noteData.octave, time, 0.25);
            }
        });
    }
}

function scheduler() {
    while (nextNoteTime < audioCtx.currentTime + SCHEDULE_AHEAD_TIME) {
        scheduleNote(AppState.currentPlayStep, AppState.currentPlayBlock, nextNoteTime);
        nextNote();
    }
}

// --- VISUAL LOOP ---

function drawLoop() {
    const currentTime = audioCtx.currentTime;
    while (visualQueue.length && visualQueue[0].time <= currentTime) {
        const event = visualQueue.shift();
        
        if (event.step === 0) renderTrackBar();

        if (event.block === AppState.editingBlock) {
            if (lastDrawnStep !== event.step) {
                window.timeMatrix.highlightPlayingStep(event.step);
                if (event.step % 4 === 0) blinkLed();
                lastDrawnStep = event.step;
            }
        } else {
             window.timeMatrix.highlightPlayingStep(-1);
        }
    }
    if (AppState.isPlaying) drawFrameId = requestAnimationFrame(drawLoop);
}

function blinkLed() {
    const led = document.getElementById('activity-led');
    if(led && !document.hidden) {
        led.classList.add('bg-white', 'shadow-white');
        setTimeout(() => led.classList.remove('bg-white', 'shadow-white'), 50);
    }
}

// --- UI RENDERERS ---

function renderSynthMenu() {
    const container = document.getElementById('synth-list-container');
    if(!container) return;
    container.innerHTML = '';
    bassSynths.forEach(synth => {
        const row = document.createElement('div');
        row.className = 'flex items-center justify-between bg-black p-2 rounded border border-gray-800';
        row.innerHTML = `<span class="text-xs font-mono text-green-500">${synth.id.toUpperCase()}</span><button class="text-[10px] text-red-500 hover:text-white px-2" onclick="removeBassSynth('${synth.id}')">REMOVE</button>`;
        container.appendChild(row);
    });
}

function renderInstrumentTabs() {
    const container = document.getElementById('instrument-tabs-container');
    if(!container) return;
    container.innerHTML = '';

    bassSynths.forEach(synth => {
        const btn = document.createElement('button');
        const isActive = AppState.activeView === synth.id;
        btn.className = `flex-1 py-2 px-4 text-xs font-bold rounded uppercase tracking-widest border transition-all min-w-[80px] ${isActive ? 'text-green-400 bg-gray-800 border-green-900 shadow' : 'text-gray-500 bg-transparent border-transparent hover:text-gray-300'}`;
        btn.innerText = synth.id;
        btn.onclick = () => setTab(synth.id);
        container.appendChild(btn);
    });

    const drumBtn = document.createElement('button');
    const isDrumActive = AppState.activeView === 'drum';
    drumBtn.className = `flex-1 py-2 px-4 text-xs font-bold rounded uppercase tracking-widest border transition-all min-w-[80px] ${isDrumActive ? 'text-green-400 bg-gray-800 border-green-900 shadow' : 'text-gray-500 bg-transparent border-transparent hover:text-gray-300'}`;
    drumBtn.innerText = "DRUM UNIT";
    drumBtn.onclick = () => setTab('drum');
    container.appendChild(drumBtn);
}

function setTab(view) {
    AppState.activeView = view;
    renderInstrumentTabs();
    updateEditors();
    const synth = getActiveSynth();
    if (synth) document.getElementById('dist-slider').value = synth.params.distortion;
}

function renderTrackBar() {
    const container = document.getElementById('track-bar');
    if(!container) return;
    container.innerHTML = '';
    const blocks = window.timeMatrix.blocks;
    document.getElementById('display-total-blocks').innerText = blocks.length;
    document.getElementById('display-current-block').innerText = AppState.editingBlock + 1;

    blocks.forEach((_, index) => {
        const el = document.createElement('div');
        el.className = 'track-block';
        el.innerText = index + 1;
        if (index === AppState.editingBlock) el.classList.add('track-block-editing');
        if (AppState.isPlaying && index === AppState.currentPlayBlock) el.classList.add('track-block-playing');
        el.onclick = () => { AppState.editingBlock = index; updateEditors(); renderTrackBar(); };
        container.appendChild(el);
    });
}

function updateEditors() {
    const bassEditor = document.getElementById('editor-bass');
    const drumEditor = document.getElementById('editor-drum');
    const info = document.getElementById('step-info-display');
    if(info) info.innerText = `STEP ${AppState.selectedStep + 1} // ${AppState.activeView.toUpperCase()}`;

    if (AppState.activeView === 'drum') {
        bassEditor.classList.add('hidden');
        drumEditor.classList.remove('hidden');
        renderDrumRows();
    } else {
        bassEditor.classList.remove('hidden');
        drumEditor.classList.add('hidden');
    }
    window.timeMatrix.selectedStep = AppState.selectedStep;
    window.timeMatrix.render(AppState.activeView, AppState.editingBlock);
}

function renderDrumRows() {
    const container = document.getElementById('editor-drum');
    if(!container) return;
    container.innerHTML = '';
    const block = window.timeMatrix.blocks[AppState.editingBlock];
    const currentDrums = block.drums[AppState.selectedStep];

    window.drumSynth.kits.forEach(kit => {
        const isActive = currentDrums.includes(kit.id);
        const btn = document.createElement('button');
        btn.className = `w-full py-3 px-4 mb-2 rounded border flex items-center justify-between font-bold transition-all ${isActive ? 'bg-gray-800 border-green-500 text-green-400' : 'bg-transparent border-gray-700 text-gray-500 hover:border-gray-500'}`;
        btn.innerHTML = `<span class="text-xs tracking-widest">${kit.name}</span><div class="w-3 h-3 rounded-full" style="background:${kit.color}"></div>`;
        btn.onclick = () => {
            initEngine();
            if (isActive) {
                const idx = currentDrums.indexOf(kit.id);
                if (idx > -1) currentDrums.splice(idx, 1);
            } else {
                currentDrums.push(kit.id);
                window.drumSynth.play(kit.id, audioCtx.currentTime);
            }
            updateEditors();
        };
        container.appendChild(btn);
    });
}

function toggleTransport() {
    initEngine();
    AppState.isPlaying = !AppState.isPlaying;
    const btn = document.getElementById('btn-play');
    const icon = btn ? btn.querySelector('svg') : null;

    if (AppState.isPlaying) {
        if(btn) { btn.classList.add('border-green-500', 'shadow-[0_0_20px_#00ff41]'); icon.classList.add('text-green-500'); }
        AppState.currentPlayStep = 0;
        AppState.currentPlayBlock = AppState.editingBlock; 
        nextNoteTime = audioCtx.currentTime + 0.1;
        visualQueue = []; 
        if(clockWorker) clockWorker.postMessage("start");
        drawLoop();
    } else {
        if(btn) { btn.classList.remove('border-green-500', 'shadow-[0_0_20px_#00ff41]'); icon.classList.remove('text-green-500'); }
        if(clockWorker) clockWorker.postMessage("stop");
        cancelAnimationFrame(drawFrameId);
        window.timeMatrix.highlightPlayingStep(-1);
        renderTrackBar();
    }
}

function toggleMenu() {
    const menu = document.getElementById('main-menu');
    if (menu.classList.contains('hidden')) { menu.classList.remove('hidden'); menu.classList.add('flex'); }
    else { menu.classList.add('hidden'); menu.classList.remove('flex'); }
}

// --- SETUP LISTENERS ---
document.addEventListener('DOMContentLoaded', () => {
    document.addEventListener('click', globalUnlock);
    document.addEventListener('touchstart', globalUnlock);

    document.getElementById('btn-play').onclick = toggleTransport;
    document.getElementById('btn-open-menu').onclick = toggleMenu;
    document.getElementById('btn-menu-close').onclick = toggleMenu;
    document.getElementById('btn-add-synth').onclick = () => addBassSynth();
    document.getElementById('btn-menu-panic').onclick = () => location.reload();

    document.getElementById('btn-menu-clear').onclick = () => {
        if(confirm("Clear CURRENT block?")) {
            window.timeMatrix.clearBlock(AppState.editingBlock);
            updateEditors();
            toggleMenu();
        }
    };
    
    document.getElementById('btn-menu-track-edit').onclick = () => {
        AppState.trackEditMode = !AppState.trackEditMode;
        const controls = document.getElementById('track-edit-controls');
        if(AppState.trackEditMode) controls.classList.remove('hidden'); else controls.classList.add('hidden');
        toggleMenu();
    };

    document.getElementById('btn-dock-mode').onclick = () => {
         const panel = document.getElementById('editor-panel');
         panel.classList.toggle('panel-docked');
         panel.classList.toggle('panel-overlay');
         const ph = document.getElementById('dock-placeholder');
         if (panel.classList.contains('panel-docked')) ph.appendChild(panel); else document.body.appendChild(panel);
         lucide.createIcons();
    };

    document.getElementById('btn-add-block').onclick = () => { window.timeMatrix.addBlock(); AppState.editingBlock = window.timeMatrix.blocks.length - 1; updateEditors(); renderTrackBar(); };
    document.getElementById('btn-dup-block').onclick = () => { window.timeMatrix.duplicateBlock(AppState.editingBlock); AppState.editingBlock++; updateEditors(); renderTrackBar(); };
    document.getElementById('btn-del-block').onclick = () => { if(confirm('Del?')) { window.timeMatrix.removeBlock(AppState.editingBlock); if (AppState.editingBlock >= window.timeMatrix.blocks.length) AppState.editingBlock = Math.max(0, window.timeMatrix.blocks.length - 1); updateEditors(); renderTrackBar(); }};

    document.getElementById('bpm-input').onchange = (e) => AppState.bpm = Math.max(60, Math.min(240, parseInt(e.target.value)));

    window.addEventListener('stepSelect', (e) => {
        AppState.selectedStep = e.detail.index;
        updateEditors();
        const synth = getActiveSynth();
        if (synth && audioCtx) {
            const block = window.timeMatrix.blocks[AppState.editingBlock];
            const tracks = block.tracks;
            if(tracks && tracks[synth.id] && tracks[synth.id][AppState.selectedStep]) {
                const n = tracks[synth.id][AppState.selectedStep];
                synth.play(n.note, n.octave, audioCtx.currentTime);
            }
        }
    });

    document.querySelectorAll('.piano-key').forEach(key => {
        key.onclick = () => {
            initEngine();
            const note = key.dataset.note;
            const synth = getActiveSynth();
            if(!synth) return;
            const block = window.timeMatrix.blocks[AppState.editingBlock];
            if(!block.tracks[synth.id]) window.timeMatrix.registerTrack(synth.id);
            block.tracks[synth.id][AppState.selectedStep] = { note: note, octave: AppState.currentOctave };
            synth.play(note, AppState.currentOctave, audioCtx.currentTime);
            updateEditors();
        };
    });

    document.getElementById('btn-delete-note').onclick = () => {
        const synth = getActiveSynth();
        if(synth) { window.timeMatrix.blocks[AppState.editingBlock].tracks[synth.id][AppState.selectedStep] = null; updateEditors(); }
    };

    const octDisplay = document.getElementById('oct-display');
    document.getElementById('oct-up').onclick = () => { if(AppState.currentOctave < 6) AppState.currentOctave++; octDisplay.innerText = AppState.currentOctave; };
    document.getElementById('oct-down').onclick = () => { if(AppState.currentOctave > 1) AppState.currentOctave--; octDisplay.innerText = AppState.currentOctave; };
    document.getElementById('dist-slider').oninput = (e) => { const val = parseInt(e.target.value); const synth = getActiveSynth(); if(synth) synth.setDistortion(val); };

    // Initial Load sequence
    // 1. Add default synth (will trigger renderSynthMenu, renderTabs, setTab)
    addBassSynth('bass-1', true);
    // 2. Render track bar explicitly
    renderTrackBar();
    lucide.createIcons();
});