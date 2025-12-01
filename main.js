/*
 * NEURODARK MAIN CONTROLLER v9 (No Overlay)
 */

// STATE
const AppState = {
    isPlaying: false,
    bpm: 174,
    currentPlayStep: 0,
    currentPlayBlock: 0,
    editingBlock: 0,
    selectedStep: 0,
    activeView: 'bass',
    currentOctave: 3,
    distortionLevel: 20,
    panelMode: 'docked',
    trackEditMode: false
};

// AUDIO GLOBALS
let audioCtx = null;
let masterGain = null;
let clockWorker = null;

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
    // Si ya existe contexto y está corriendo, no hacemos nada
    if (audioCtx && audioCtx.state === 'running') return;

    if (!audioCtx) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AudioContext({ latencyHint: 'interactive' });
        
        masterGain = audioCtx.createGain();
        masterGain.gain.value = 0.6;
        
        const limiter = audioCtx.createDynamicsCompressor();
        limiter.threshold.value = -3;
        limiter.ratio.value = 12;
        
        masterGain.connect(limiter);
        limiter.connect(audioCtx.destination);

        if(window.bassSynth) window.bassSynth.init(audioCtx, masterGain);
        if(window.drumSynth) window.drumSynth.init(audioCtx, masterGain);

        // Worker Setup
        if (!clockWorker) {
            clockWorker = new Worker('Synth/clock_worker.js');
            clockWorker.onmessage = (e) => { if (e.data === "tick") scheduler(); };
            clockWorker.postMessage({ interval: LOOKAHEAD_INTERVAL });
        }
        
        console.log("Audio Engine: ONLINE");
    }

    // Siempre intentar reanudar (necesario tras primer click en el documento)
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
}

// Global unlocker for first interaction
function globalUnlock() {
    initEngine();
    // Remove listeners once unlocked to save resources
    if (audioCtx && audioCtx.state === 'running') {
        document.removeEventListener('click', globalUnlock);
        document.removeEventListener('touchstart', globalUnlock);
    }
}

// --- AUDIO SCHEDULER ---

function nextNote() {
    const secondsPerBeat = 60.0 / AppState.bpm;
    const secondsPerStep = secondsPerBeat / 4; 
    nextNoteTime += secondsPerStep;
    
    AppState.currentPlayStep++;
    
    // Loop / Block logic
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

    if (data.bass && window.bassSynth) {
        window.bassSynth.play(data.bass.note, data.bass.octave, time, 0.25, AppState.distortionLevel);
    }
    if (data.drums && window.drumSynth) {
        data.drums.forEach(id => window.drumSynth.play(id, time));
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
                
                if (event.step % 4 === 0) {
                    const led = document.getElementById('activity-led');
                    if(led && !document.hidden) {
                        led.style.backgroundColor = '#fff';
                        led.style.boxShadow = '0 0 10px #fff';
                        setTimeout(() => {
                            led.style.backgroundColor = ''; 
                            led.style.boxShadow = '';
                        }, 50);
                    }
                }
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

// --- UI MANAGERS ---

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

function toggleTransport() {
    initEngine(); // Ensure ON

    AppState.isPlaying = !AppState.isPlaying;
    const btn = document.getElementById('btn-play');
    const icon = btn ? btn.querySelector('svg') : null;

    if (AppState.isPlaying) {
        if(btn) {
            btn.classList.add('border-green-500', 'shadow-[0_0_20px_#00ff41]');
            btn.classList.remove('border-gray-700');
            if(icon) {
                icon.classList.add('text-green-500');
                icon.innerHTML = `<rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect>`; 
            }
        }

        AppState.currentPlayStep = 0;
        AppState.currentPlayBlock = AppState.editingBlock; // Start from visible block
        nextNoteTime = audioCtx.currentTime + 0.1;
        visualQueue = []; 
        
        if(clockWorker) clockWorker.postMessage("start");
        drawLoop();

    } else {
        if(btn) {
            btn.classList.remove('border-green-500', 'shadow-[0_0_20px_#00ff41]');
            btn.classList.add('border-gray-700');
            if(icon) {
                icon.classList.remove('text-green-500');
                icon.innerHTML = `<polygon points="5 3 19 12 5 21 5 3"></polygon>`;
            }
        }

        if(clockWorker) clockWorker.postMessage("stop");
        cancelAnimationFrame(drawFrameId);
        window.timeMatrix.highlightPlayingStep(-1);
        renderTrackBar();
    }
}

function toggleMenu() {
    const menu = document.getElementById('main-menu');
    // Force Lucide icons refresh when opening menu just in case
    if (menu.classList.contains('hidden')) {
        menu.classList.remove('hidden');
        menu.classList.add('flex');
    } else {
        menu.classList.add('hidden');
        menu.classList.remove('flex');
    }
}

function updateEditors() {
    const bassEditor = document.getElementById('editor-bass');
    const drumEditor = document.getElementById('editor-drum');
    const info = document.getElementById('step-info-display');

    if(info) info.innerText = `STEP ${AppState.selectedStep + 1} // ${AppState.activeView.toUpperCase()}`;

    if (AppState.activeView === 'bass') {
        if(bassEditor) bassEditor.classList.remove('hidden');
        if(drumEditor) drumEditor.classList.add('hidden');
    } else {
        if(bassEditor) bassEditor.classList.add('hidden');
        if(drumEditor) drumEditor.classList.remove('hidden');
        renderDrumRows(); 
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

// --- SETUP ---

document.addEventListener('DOMContentLoaded', () => {
    // 1. Attach Global Unlockers (Replaces Start Overlay)
    document.addEventListener('click', globalUnlock);
    document.addEventListener('touchstart', globalUnlock);

    // 2. Buttons
    document.getElementById('btn-play').onclick = toggleTransport;
    document.getElementById('btn-open-menu').onclick = toggleMenu;
    document.getElementById('btn-menu-close').onclick = toggleMenu;

    document.getElementById('btn-menu-panic').onclick = () => {
        initEngine();
        if(window.drumSynth) window.drumSynth.createNoiseBuffer();
        toggleMenu();
        alert("Audio Reset.");
    };

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
        if(AppState.trackEditMode) controls.classList.remove('hidden');
        else controls.classList.add('hidden');
        toggleMenu();
    };

    document.getElementById('btn-dock-mode').onclick = () => {
         const panel = document.getElementById('editor-panel');
         panel.classList.toggle('panel-docked');
         panel.classList.toggle('panel-overlay');
         const ph = document.getElementById('dock-placeholder');
         if (panel.classList.contains('panel-docked')) ph.appendChild(panel);
         else document.body.appendChild(panel);
         lucide.createIcons();
    };

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
            if (AppState.editingBlock >= window.timeMatrix.blocks.length) {
                AppState.editingBlock = Math.max(0, window.timeMatrix.blocks.length - 1);
            }
            updateEditors();
            renderTrackBar();
        }
    };

    // Params
    document.getElementById('bpm-input').onchange = (e) => AppState.bpm = Math.max(60, Math.min(240, parseInt(e.target.value)));

    // Tabs
    const tabBass = document.getElementById('tab-bass');
    const tabDrum = document.getElementById('tab-drum');
    
    const setTab = (view) => {
        AppState.activeView = view;
        const activeClass = ['text-green-400', 'bg-gray-800', 'border-green-900', 'shadow'];
        const inactiveClass = ['text-gray-500', 'bg-transparent', 'border-transparent'];
        
        if (view === 'bass') {
            tabBass.classList.add(...activeClass);
            tabBass.classList.remove(...inactiveClass);
            tabDrum.classList.remove(...activeClass);
            tabDrum.classList.add(...inactiveClass);
        } else {
            tabDrum.classList.add(...activeClass);
            tabDrum.classList.remove(...inactiveClass);
            tabBass.classList.remove(...activeClass);
            tabBass.classList.add(...inactiveClass);
        }
        updateEditors();
    };
    
    tabBass.onclick = () => setTab('bass');
    tabDrum.onclick = () => setTab('drum');

    // Matrix
    window.addEventListener('stepSelect', (e) => {
        AppState.selectedStep = e.detail.index;
        updateEditors();
        if (AppState.activeView === 'bass' && window.bassSynth && audioCtx) {
            const block = window.timeMatrix.blocks[AppState.editingBlock];
            const bass = block.bass[AppState.selectedStep];
            if (bass) window.bassSynth.play(bass.note, bass.octave, audioCtx.currentTime);
        }
    });

    // Piano
    document.querySelectorAll('.piano-key').forEach(key => {
        key.onclick = () => {
            initEngine();
            const note = key.dataset.note;
            const block = window.timeMatrix.blocks[AppState.editingBlock];
            block.bass[AppState.selectedStep] = { note: note, octave: AppState.currentOctave };
            window.bassSynth.play(note, AppState.currentOctave, audioCtx.currentTime, 0.3, AppState.distortionLevel);
            updateEditors();
        };
    });

    document.getElementById('btn-delete-note').onclick = () => {
        window.timeMatrix.blocks[AppState.editingBlock].bass[AppState.selectedStep] = null;
        updateEditors();
    };

    // Octave & Distortion
    const octDisplay = document.getElementById('oct-display');
    document.getElementById('oct-up').onclick = () => { if(AppState.currentOctave < 6) AppState.currentOctave++; octDisplay.innerText = AppState.currentOctave; };
    document.getElementById('oct-down').onclick = () => { if(AppState.currentOctave > 1) AppState.currentOctave--; octDisplay.innerText = AppState.currentOctave; };
    document.getElementById('dist-slider').oninput = (e) => {
        AppState.distortionLevel = parseInt(e.target.value);
        if(window.bassSynth) window.bassSynth.updateDistortionCurve(AppState.distortionLevel);
    };

    // Init
    renderTrackBar();
    updateEditors();
    lucide.createIcons();
});