/*
 * NEURODARK MAIN CONTROLLER v7 (Worker Threaded)
 * Features: Web Worker Clock for stable background playback
 */

// STATE
const AppState = {
    isPlaying: false,
    bpm: 174,
    currentStep: 0,
    activeView: 'bass',
    selectedStep: 0,
    currentOctave: 3,
    distortionLevel: 20,
    panelMode: 'docked'
};

// AUDIO GLOBALS
let audioCtx = null;
let masterGain = null;

// SCHEDULING GLOBALS
let nextNoteTime = 0.0;
const SCHEDULE_AHEAD_TIME = 0.1; // 100ms
const LOOKAHEAD_INTERVAL = 25;   // 25ms

// WORKER (The background heartbeat)
let clockWorker = null;

// VISUAL QUEUE
let visualQueue = [];
let drawFrameId = null;
let lastDrawnStep = -1;

// --- INITIALIZATION ---

function initEngine() {
    // 1. Audio Context
    if (!audioCtx) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AudioContext({
            latencyHint: 'interactive', // Prioritize low latency
            sampleRate: 44100
        });
        
        masterGain = audioCtx.createGain();
        masterGain.gain.value = 0.6;
        
        // Limiter
        const limiter = audioCtx.createDynamicsCompressor();
        limiter.threshold.value = -3;
        limiter.ratio.value = 12;
        limiter.attack.value = 0.003;
        
        masterGain.connect(limiter);
        limiter.connect(audioCtx.destination);

        // Init Modules
        if(window.bassSynth) window.bassSynth.init(audioCtx, masterGain);
        if(window.drumSynth) window.drumSynth.init(audioCtx, masterGain);

        // Init Worker
        if (!clockWorker) {
            clockWorker = new Worker('Synth/clock_worker.js');
            clockWorker.onmessage = (e) => {
                if (e.data === "tick") {
                    scheduler();
                }
            };
            clockWorker.postMessage({ interval: LOOKAHEAD_INTERVAL });
        }

        // Cleanup UI
        const overlay = document.getElementById('start-overlay');
        if(overlay) {
            overlay.style.opacity = '0';
            setTimeout(() => overlay.remove(), 500);
        }
        
        const led = document.getElementById('activity-led');
        if(led) led.classList.replace('bg-red-900', 'bg-green-600');
        
        console.log("NeuroDark Engine: WORKER THREAD ACTIVE");
    }

    // 2. Always Resume
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
}

// --- AUDIO SCHEDULER ---

function nextNote() {
    const secondsPerBeat = 60.0 / AppState.bpm;
    const secondsPerStep = secondsPerBeat / 4; // 1/16th note
    nextNoteTime += secondsPerStep;
    
    AppState.currentStep++;
    if (AppState.currentStep >= window.timeMatrix.totalSteps) {
        AppState.currentStep = 0;
    }
}

function scheduleNote(stepNumber, time) {
    // Push to Visual Queue
    visualQueue.push({ step: stepNumber, time: time });

    // Audio Trigger
    const data = window.timeMatrix.getStepData(stepNumber);

    if (data.bass && window.bassSynth) {
        window.bassSynth.play(
            data.bass.note, 
            data.bass.octave, 
            time, 
            0.25, 
            AppState.distortionLevel
        );
    }

    if (data.drums && data.drums.length > 0 && window.drumSynth) {
        data.drums.forEach(drumId => {
            window.drumSynth.play(drumId, time);
        });
    }
}

function scheduler() {
    // This is now triggered by the Worker "tick"
    // It runs reliably even in background tabs
    
    // Look ahead and schedule
    while (nextNoteTime < audioCtx.currentTime + SCHEDULE_AHEAD_TIME) {
        scheduleNote(AppState.currentStep, nextNoteTime);
        nextNote();
    }
}

// --- VISUAL LOOP (UI Thread) ---
// This might stop in background, but audio won't

function drawLoop() {
    const currentTime = audioCtx.currentTime;

    while (visualQueue.length && visualQueue[0].time <= currentTime) {
        const event = visualQueue.shift();
        
        if (lastDrawnStep !== event.step) {
            window.timeMatrix.highlightPlayingStep(event.step);
            
            // LED Blink
            if (event.step % 4 === 0) {
                const led = document.getElementById('activity-led');
                if(led && !document.hidden) { // Only animate if visible to save CPU
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
    }

    if (AppState.isPlaying) {
        drawFrameId = requestAnimationFrame(drawLoop);
    }
}

// --- TRANSPORT ---

function toggleTransport() {
    initEngine();

    AppState.isPlaying = !AppState.isPlaying;
    const btn = document.getElementById('btn-play');
    const icon = btn ? btn.querySelector('svg') : null;

    if (AppState.isPlaying) {
        // START
        if(btn) {
            btn.classList.add('border-green-500', 'shadow-[0_0_20px_#00ff41]');
            btn.classList.remove('border-gray-700');
            if(icon) {
                icon.classList.add('text-green-500');
                icon.innerHTML = `<rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect>`; 
            }
        }

        AppState.currentStep = 0;
        nextNoteTime = audioCtx.currentTime + 0.1;
        visualQueue = []; 
        
        // Start Worker (Audio Clock)
        if(clockWorker) clockWorker.postMessage("start");
        
        // Start Visuals
        drawLoop();

    } else {
        // STOP
        if(btn) {
            btn.classList.remove('border-green-500', 'shadow-[0_0_20px_#00ff41]');
            btn.classList.add('border-gray-700');
            if(icon) {
                icon.classList.remove('text-green-500');
                icon.innerHTML = `<polygon points="5 3 19 12 5 21 5 3"></polygon>`;
            }
        }

        // Stop Worker
        if(clockWorker) clockWorker.postMessage("stop");
        cancelAnimationFrame(drawFrameId);
        
        // Reset Visuals
        if(window.timeMatrix && window.timeMatrix.container) {
            const old = window.timeMatrix.container.querySelector('.step-playing');
            if (old) old.classList.remove('step-playing');
        }
    }
}

// --- UI HANDLERS ---

function togglePanelMode() {
    const panel = document.getElementById('editor-panel');
    const dockPlaceholder = document.getElementById('dock-placeholder');
    const btn = document.getElementById('btn-dock-mode');
    
    if (AppState.panelMode === 'overlay') {
        AppState.panelMode = 'docked';
        panel.classList.remove('panel-overlay');
        panel.classList.add('panel-docked');
        dockPlaceholder.appendChild(panel);
        btn.innerHTML = '<i data-lucide="maximize-2" class="w-4 h-4"></i>';
    } else {
        AppState.panelMode = 'overlay';
        panel.classList.remove('panel-docked');
        panel.classList.add('panel-overlay');
        document.body.appendChild(panel);
        btn.innerHTML = '<i data-lucide="minimize-2" class="w-4 h-4"></i>';
    }
    lucide.createIcons();
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
    window.timeMatrix.render(AppState.activeView);
}

function renderDrumRows() {
    const container = document.getElementById('editor-drum');
    if(!container) return;
    container.innerHTML = '';
    const currentDrums = window.timeMatrix.pattern.drums[AppState.selectedStep];

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
                window.timeMatrix.pattern.drums[AppState.selectedStep] = currentDrums.filter(d => d !== kit.id);
            } else {
                window.timeMatrix.pattern.drums[AppState.selectedStep].push(kit.id);
                window.drumSynth.play(kit.id, audioCtx.currentTime);
            }
            updateEditors();
        };
        container.appendChild(btn);
    });
}

// --- LISTENERS ---

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btn-play').onclick = toggleTransport;
    document.getElementById('start-overlay').onclick = initEngine;
    document.getElementById('btn-dock-mode').onclick = togglePanelMode;

    document.getElementById('bpm-input').onchange = (e) => {
        AppState.bpm = Math.max(60, Math.min(240, parseInt(e.target.value)));
    };

    const tabBass = document.getElementById('tab-bass');
    const tabDrum = document.getElementById('tab-drum');
    const setActiveTab = (mode) => {
        AppState.activeView = mode;
        if(mode === 'bass') {
            tabBass.classList.replace('text-gray-500', 'text-green-400');
            tabBass.classList.replace('border-transparent', 'border-green-900');
            tabBass.classList.add('bg-gray-800');
            tabDrum.classList.replace('text-green-400', 'text-gray-500');
            tabDrum.classList.replace('border-green-900', 'border-transparent');
            tabDrum.classList.remove('bg-gray-800');
        } else {
            tabDrum.classList.replace('text-gray-500', 'text-green-400');
            tabDrum.classList.replace('border-transparent', 'border-green-900');
            tabDrum.classList.add('bg-gray-800');
            tabBass.classList.replace('text-green-400', 'text-gray-500');
            tabBass.classList.replace('border-green-900', 'border-transparent');
            tabBass.classList.remove('bg-gray-800');
        }
        updateEditors();
    };
    if(tabBass) tabBass.onclick = () => setActiveTab('bass');
    if(tabDrum) tabDrum.onclick = () => setActiveTab('drum');

    window.addEventListener('stepSelect', (e) => {
        AppState.selectedStep = e.detail.index;
        updateEditors();
        if (AppState.activeView === 'bass' && window.bassSynth && audioCtx) {
            const data = window.timeMatrix.getStepData(AppState.selectedStep);
            if (data.bass) window.bassSynth.play(data.bass.note, data.bass.octave, audioCtx.currentTime);
        }
    });

    // Synth Controls
    const octDisplay = document.getElementById('oct-display');
    document.getElementById('oct-up').onclick = () => {
        if(AppState.currentOctave < 6) AppState.currentOctave++;
        if(octDisplay) octDisplay.innerText = AppState.currentOctave;
    };
    document.getElementById('oct-down').onclick = () => {
        if(AppState.currentOctave > 1) AppState.currentOctave--;
        if(octDisplay) octDisplay.innerText = AppState.currentOctave;
    };
    
    document.getElementById('dist-slider').oninput = (e) => {
        AppState.distortionLevel = parseInt(e.target.value);
        if(window.bassSynth) window.bassSynth.updateDistortionCurve(AppState.distortionLevel);
    };

    document.querySelectorAll('.piano-key').forEach(key => {
        key.onclick = () => {
            initEngine();
            const note = key.dataset.note;
            window.timeMatrix.pattern.bass[AppState.selectedStep] = { note: note, octave: AppState.currentOctave };
            window.bassSynth.play(note, AppState.currentOctave, audioCtx.currentTime, 0.3, AppState.distortionLevel);
            updateEditors();
        };
    });

    document.getElementById('btn-delete-note').onclick = () => {
        window.timeMatrix.pattern.bass[AppState.selectedStep] = null;
        updateEditors();
    };

    document.getElementById('grid-selector').onchange = (e) => window.timeMatrix.setGridColumns(e.target.value);
    document.getElementById('btn-reset').onclick = () => {
        if(confirm('Clear all?')) {
            window.timeMatrix.pattern.bass.fill(null);
            window.timeMatrix.pattern.drums.forEach(d => d.length = 0);
            updateEditors();
        }
    };

    if(AppState.panelMode === 'docked') {
         const panel = document.getElementById('editor-panel');
         const dockPlaceholder = document.getElementById('dock-placeholder');
         if(panel && dockPlaceholder) {
             panel.classList.remove('panel-overlay');
             panel.classList.add('panel-docked');
             dockPlaceholder.appendChild(panel);
         }
    }

    updateEditors();
    lucide.createIcons();
});