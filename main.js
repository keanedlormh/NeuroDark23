/*
 * NEURODARK MAIN CONTROLLER v12 (Stability Fix)
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

// VISUAL QUEUE
let visualQueue = [];
let drawFrameId = null;
let lastDrawnStep = -1;

// --- INITIALIZATION ---

function initEngine() {
    // Resume context if suspended (common browser policy)
    if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    
    if (audioCtx) return;

    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AudioContext({ latencyHint: 'interactive' });
        
        masterGain = audioCtx.createGain();
        masterGain.gain.value = 0.6;
        
        // Master Bus Processing
        const limiter = audioCtx.createDynamicsCompressor();
        limiter.threshold.value = -2;
        limiter.ratio.value = 16;
        masterGain.connect(limiter);
        limiter.connect(audioCtx.destination);

        // Init Synths
        if (bassSynths.length === 0) {
            // Force create default synth
            addBassSynth('bass-1', false); 
        } else {
            bassSynths.forEach(s => s.init(audioCtx, masterGain));
        }

        if(window.drumSynth) window.drumSynth.init(audioCtx, masterGain);

        // Worker Init
        if (!clockWorker) {
            try {
                clockWorker = new Worker('Synth/clock_worker.js');
                clockWorker.onmessage = (e) => { 
                    if (e.data === "tick") scheduler(); 
                };
                clockWorker.postMessage({ interval: LOOKAHEAD_INTERVAL });
            } catch (e) {
                console.warn("Worker failed, falling back to interval", e);
                // Fallback for environments blocking workers
                setInterval(scheduler, LOOKAHEAD_INTERVAL);
            }
        }
        
        console.log("Audio Engine: ONLINE");
    } catch(e) {
        console.error("Init Error", e);
        alert("Audio initialization failed. Please reload.");
    }
}

// --- SYNTH MANAGER ---

function addBassSynth(customId = null, shouldRender = true) {
    const id = customId || `bass-${bassSynths.length + 1}`;
    
    // Prevent duplicates
    if (bassSynths.find(s => s.id === id)) return;

    // Check if class exists (safety)
    if (typeof BassSynth === 'undefined') {
        console.error("BassSynth class missing!");
        return;
    }

    const newSynth = new BassSynth(id);
    if (audioCtx) newSynth.init(audioCtx, masterGain);
    
    bassSynths.push(newSynth);
    
    // Register in Matrix
    if(window.timeMatrix) window.timeMatrix.registerTrack(id);

    if (shouldRender) {
        renderSynthMenu();
        renderInstrumentTabs();
        setTab(id);
    }
}

function removeBassSynth(id) {
    if (bassSynths.length <= 1) {
        alert("Cannot remove the last synth.");
        return;
    }
    
    if (confirm(`Remove ${id}?`)) {
        bassSynths = bassSynths.filter(s => s.id !== id);
        if(window.timeMatrix) window.timeMatrix.removeTrack(id);
        
        // Switch view if we removed the active one
        if (AppState.activeView === id) {
            AppState.activeView = bassSynths[0].id;
        }
        
        renderSynthMenu();
        renderInstrumentTabs();
        updateEditors();
    }
}

function getActiveSynth() {
    return bassSynths.find(s => s.id === AppState.activeView);
}

// --- AUDIO SCHEDULER ---

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

    // Drums
    if (data.drums && window.drumSynth) {
        data.drums.forEach(id => window.drumSynth.play(id, time));
    }

    // Tracks (Bass)
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

    if (AppState.isPlaying) {
        drawFrameId = requestAnimationFrame(drawLoop);
    }
}

function blinkLed() {
    const led = document.getElementById('activity-led');
    if(led && !document.hidden) {
        led.classList.add('bg-white', 'shadow-white');
        setTimeout(() => led.classList.remove('bg-white', 'shadow-white'), 50);
    }
}

// --- UI MANAGERS ---

function renderSynthMenu() {
    const container = document.getElementById('synth-list-container');
    if(!container) return;
    container.innerHTML = '';

    bassSynths.forEach(synth => {
        const row = document.createElement('div');
        row.className = 'flex items-center justify-between bg-black p-2 rounded border border-gray-800';
        row.innerHTML = `
            <span class="text-xs font-mono text-green-500">${synth.id.toUpperCase()}</span>
            <button class="text-[10px] text-red-500 hover:text-white px-2 remove-synth-btn" data-id="${synth.id}">REMOVE</button>
        `;
        container.appendChild(row);
    });
    
    // Bind removals
    container.querySelectorAll('.remove-synth-btn').forEach(btn => {
        btn.onclick = () => removeBassSynth(btn.dataset.id);
    });
}

function renderInstrumentTabs() {
    const container = document.getElementById('instrument-tabs-container');
    if(!container) return;
    container.innerHTML = '';

    // Synths
    bassSynths.forEach(synth => {
        const btn = document.createElement('button');
        const isActive = AppState.activeView === synth.id;
        btn.className = `flex-1 py-2 px-4 text-xs font-bold rounded uppercase tracking-widest border transition-all min-w-[80px] mb-1 ${
            isActive 
            ? 'text-green-400 bg-gray-800 border-green-900 shadow' 
            : 'text-gray-500 bg-transparent border-transparent hover:text-gray-300'
        }`;
        btn.innerText = synth.id;
        btn.onclick = () => setTab(synth.id);
        container.appendChild(btn);
    });

    // Drums
    const drumBtn = document.createElement('button');
    const isDrumActive = AppState.activeView === 'drum';
    drumBtn.className = `flex-1 py-2 px-4 text-xs font-bold rounded uppercase tracking-widest border transition-all min-w-[80px] mb-1 ${
        isDrumActive 
        ? 'text-green-400 bg-gray-800 border-green-900 shadow' 
        : 'text-gray-500 bg-transparent border-transparent hover:text-gray-300'
    }`;
    drumBtn.innerText = "DRUM UNIT";
    drumBtn.onclick = () => setTab('drum');
    container.appendChild(drumBtn);
}

function setTab(view) {
    AppState.activeView = view;
    renderInstrumentTabs();
    updateEditors();
    
    const synth = getActiveSynth();
    if (synth) {
        const slider = document.getElementById('dist-slider');
        if(slider) slider.value = synth.params.distortion;
    }
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
        
        el.onclick = () => {
            AppState.editingBlock = index;
            updateEditors();
            renderTrackBar();
        };
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
        btn.className = `w-full py-3 px-4 mb-2 rounded border flex items-center justify-between font-bold transition-all ${
            isActive 
            ? 'bg-gray-800 border-green-500 text-green-400' 
            : 'bg-transparent border-gray-700 text-gray-500 hover:border-gray-500'
        }`;
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
        nextNoteTime = audioCtx.currentTime + 0.05; // Short buffer
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

// --- SETUP LISTENERS ---

document.addEventListener('DOMContentLoaded', () => {
    // UI Elements
    const playBtn = document.getElementById('btn-play');
    const menuBtn = document.getElementById('btn-open-menu');
    const closeMenuBtn = document.getElementById('btn-menu-close');
    const addSynthBtn = document.getElementById('btn-add-synth');
    const bpmInput = document.getElementById('bpm-input');
    
    // Binding
    if(playBtn) playBtn.onclick = toggleTransport;
    
    const menu = document.getElementById('main-menu');
    const toggleMenu = () => {
        if (menu.classList.contains('hidden')) { menu.classList.remove('hidden'); menu.classList.add('flex'); renderSynthMenu(); }
        else { menu.classList.add('hidden'); menu.classList.remove('flex'); }
    };
    if(menuBtn) menuBtn.onclick = toggleMenu;
    if(closeMenuBtn) closeMenuBtn.onclick = toggleMenu;

    if(addSynthBtn) addSynthBtn.onclick = () => addBassSynth();

    // Track Edit
    document.getElementById('btn-add-block').onclick = () => {
        window.timeMatrix.addBlock();
        AppState.editingBlock = window.timeMatrix.blocks.length - 1;
        updateEditors();
        renderTrackBar();
    };
    document.getElementById('btn-dup-block').onclick = () => {
        window.timeMatrix.duplicateBlock(AppState.editingBlock);
        AppState.editingBlock++;
        updateEditors();
        renderTrackBar();
    };
    document.getElementById('btn-del-block').onclick = () => {
        if(confirm('Delete block?')) {
            window.timeMatrix.removeBlock(AppState.editingBlock);
            if (AppState.editingBlock >= window.timeMatrix.blocks.length) AppState.editingBlock = Math.max(0, window.timeMatrix.blocks.length - 1);
            updateEditors();
            renderTrackBar();
        }
    };

    if(bpmInput) bpmInput.onchange = (e) => AppState.bpm = Math.max(60, Math.min(240, parseInt(e.target.value)));

    // Matrix
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

    // Piano Keys
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
        if(synth) {
            window.timeMatrix.blocks[AppState.editingBlock].tracks[synth.id][AppState.selectedStep] = null;
            updateEditors();
        }
    };

    // Sliders
    const octDisplay = document.getElementById('oct-display');
    document.getElementById('oct-up').onclick = () => { if(AppState.currentOctave < 6) AppState.currentOctave++; octDisplay.innerText = AppState.currentOctave; };
    document.getElementById('oct-down').onclick = () => { if(AppState.currentOctave > 1) AppState.currentOctave--; octDisplay.innerText = AppState.currentOctave; };
    document.getElementById('dist-slider').oninput = (e) => {
        const val = parseInt(e.target.value);
        const synth = getActiveSynth();
        if(synth) synth.setDistortion(val);
    };

    // Dock Button
    document.getElementById('btn-dock-mode').onclick = () => {
         const panel = document.getElementById('editor-panel');
         panel.classList.toggle('panel-docked');
         panel.classList.toggle('panel-overlay');
         const ph = document.getElementById('dock-placeholder');
         if (panel.classList.contains('panel-docked')) ph.appendChild(panel);
         else document.body.appendChild(panel);
         lucide.createIcons();
    };

    // Initial Load - Safe Order
    if (window.timeMatrix && window.timeMatrix.containerId) {
        initEngine(); // Attempt basic audio init
        renderInstrumentTabs();
        updateEditors();
        renderTrackBar();
        lucide.createIcons();
    } else {
        console.error("Critical: TimeMatrix not loaded");
    }
});