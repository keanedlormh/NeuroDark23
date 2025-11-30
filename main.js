/*
 * NEURODARK MAIN CONTROLLER v5 (Sync Fix)
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
let schedulerTimerID = null;
let nextNoteTime = 0.0;
const LOOKAHEAD = 0.1; // 100ms
const CHECK_INTERVAL = 25; // 25ms

// --- INITIALIZATION ---

function initEngine() {
    // 1. Create Context if missing
    if (!audioCtx) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AudioContext();
        
        masterGain = audioCtx.createGain();
        masterGain.gain.value = 0.6;
        
        const limiter = audioCtx.createDynamicsCompressor();
        limiter.threshold.value = -3;
        masterGain.connect(limiter);
        limiter.connect(audioCtx.destination);

        // Init Modules safely
        if(window.bassSynth) window.bassSynth.init(audioCtx, masterGain);
        if(window.drumSynth) window.drumSynth.init(audioCtx, masterGain);

        // UI Feedback
        const overlay = document.getElementById('start-overlay');
        if(overlay) {
            overlay.style.opacity = '0';
            setTimeout(() => overlay.remove(), 500);
        }
        
        const led = document.getElementById('activity-led');
        if(led) led.classList.replace('bg-red-900', 'bg-green-600');
        
        console.log("Audio Engine Initialized");
    }

    // 2. Always Resume on interaction
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
}

// --- SCHEDULER CORE ---

function nextNote() {
    const secondsPerBeat = 60.0 / AppState.bpm;
    const secondsPerStep = secondsPerBeat / 4; // 1/16th note
    nextNoteTime += secondsPerStep;
    
    // Advance step count
    AppState.currentStep++;
    if (AppState.currentStep >= window.timeMatrix.totalSteps) {
        AppState.currentStep = 0;
    }
}

function scheduleNote(stepNumber, time) {
    // 1. VISUAL SYNC
    // Calculate precise delay for visual update
    const delay = Math.max(0, (time - audioCtx.currentTime) * 1000);
    
    setTimeout(() => {
        // Trigger Matrix Visual
        if(window.timeMatrix) window.timeMatrix.highlightPlayingStep(stepNumber);
        
        // Blink LED
        if (stepNumber % 4 === 0) {
            const led = document.getElementById('activity-led');
            if(led) {
                led.classList.add('bg-white', 'shadow-white');
                setTimeout(() => led.classList.remove('bg-white', 'shadow-white'), 50);
            }
        }
    }, delay);

    // 2. AUDIO TRIGGERING
    const data = window.timeMatrix.getStepData(stepNumber);

    // Play Bass
    if (data.bass && window.bassSynth) {
        window.bassSynth.play(
            data.bass.note, 
            data.bass.octave, 
            time, 
            0.3, 
            AppState.distortionLevel
        );
    }

    // Play Drums
    if (data.drums && data.drums.length > 0 && window.drumSynth) {
        data.drums.forEach(drumId => {
            window.drumSynth.play(drumId, time);
        });
    }
}

function scheduler() {
    // Schedule notes ahead of time
    while (nextNoteTime < audioCtx.currentTime + LOOKAHEAD) {
        scheduleNote(AppState.currentStep, nextNoteTime);
        nextNote();
    }
    
    if (AppState.isPlaying) {
        schedulerTimerID = setTimeout(scheduler, CHECK_INTERVAL);
    }
}

function toggleTransport() {
    initEngine(); // Force engine ON

    AppState.isPlaying = !AppState.isPlaying;
    const btn = document.getElementById('btn-play');
    const icon = btn ? btn.querySelector('svg') : null;

    if (AppState.isPlaying) {
        // --- START ---
        if(btn) {
            btn.classList.add('border-green-500', 'shadow-[0_0_20px_#00ff41]');
            btn.classList.remove('border-gray-700');
            if(icon) {
                icon.classList.add('text-green-500');
                icon.innerHTML = `<rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect>`; 
            }
        }

        // Reset Sequence
        AppState.currentStep = 0;
        nextNoteTime = audioCtx.currentTime + 0.05; // Buffer to avoid click
        
        scheduler(); // START LOOP
    } else {
        // --- STOP ---
        if(btn) {
            btn.classList.remove('border-green-500', 'shadow-[0_0_20px_#00ff41]');
            btn.classList.add('border-gray-700');
            if(icon) {
                icon.classList.remove('text-green-500');
                icon.innerHTML = `<polygon points="5 3 19 12 5 21 5 3"></polygon>`;
            }
        }

        clearTimeout(schedulerTimerID);
        // Clean up visual highlight
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
        
        btn.innerHTML = `
            <span class="text-xs tracking-widest">${kit.name}</span>
            <div class="w-3 h-3 rounded-full" style="background:${kit.color}"></div>
        `;

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

// --- SETUP LISTENERS ---

document.addEventListener('DOMContentLoaded', () => {
    // 1. UI Elements
    const btnPlay = document.getElementById('btn-play');
    const bpmInput = document.getElementById('bpm-input');
    const tabBass = document.getElementById('tab-bass');
    const tabDrum = document.getElementById('tab-drum');
    const dockBtn = document.getElementById('btn-dock-mode');
    const resetBtn = document.getElementById('btn-reset');
    const overlay = document.getElementById('start-overlay');

    // 2. Event Binding
    if(btnPlay) btnPlay.onclick = toggleTransport;
    if(overlay) overlay.onclick = initEngine;
    if(dockBtn) dockBtn.onclick = togglePanelMode;

    if(bpmInput) bpmInput.onchange = (e) => {
        AppState.bpm = Math.max(60, Math.min(240, parseInt(e.target.value)));
    };

    if(resetBtn) resetBtn.onclick = () => {
        if(confirm('Clear all pattern data?')) {
            window.timeMatrix.pattern.bass.fill(null);
            window.timeMatrix.pattern.drums.forEach(d => d.length = 0);
            updateEditors();
        }
    };

    // Tabs
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

    // Matrix Events
    window.addEventListener('stepSelect', (e) => {
        AppState.selectedStep = e.detail.index;
        updateEditors();
        if (AppState.activeView === 'bass' && window.bassSynth && audioCtx) {
            const data = window.timeMatrix.getStepData(AppState.selectedStep);
            if (data.bass) window.bassSynth.play(data.bass.note, data.bass.octave, audioCtx.currentTime);
        }
    });

    // Bass Synth UI Controls
    const octDisplay = document.getElementById('oct-display');
    const octUp = document.getElementById('oct-up');
    const octDown = document.getElementById('oct-down');
    
    if(octUp) octUp.onclick = () => {
        if(AppState.currentOctave < 6) AppState.currentOctave++;
        if(octDisplay) octDisplay.innerText = AppState.currentOctave;
    };
    if(octDown) octDown.onclick = () => {
        if(AppState.currentOctave > 1) AppState.currentOctave--;
        if(octDisplay) octDisplay.innerText = AppState.currentOctave;
    };
    
    const distSlider = document.getElementById('dist-slider');
    if(distSlider) distSlider.oninput = (e) => AppState.distortionLevel = parseInt(e.target.value);

    // Piano Keys
    document.querySelectorAll('.piano-key').forEach(key => {
        key.onclick = () => {
            initEngine();
            const note = key.dataset.note;
            window.timeMatrix.pattern.bass[AppState.selectedStep] = {
                note: note,
                octave: AppState.currentOctave
            };
            window.bassSynth.play(note, AppState.currentOctave, audioCtx.currentTime, 0.3, AppState.distortionLevel);
            updateEditors();
        };
    });

    const delNoteBtn = document.getElementById('btn-delete-note');
    if(delNoteBtn) delNoteBtn.onclick = () => {
        window.timeMatrix.pattern.bass[AppState.selectedStep] = null;
        updateEditors();
    };

    // Grid Size
    const gridSel = document.getElementById('grid-selector');
    if(gridSel) gridSel.onchange = (e) => window.timeMatrix.setGridColumns(e.target.value);

    // Initial Setup
    // Ensure Panel is docked correctly in DOM based on default state
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