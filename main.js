/*
 * NEURODARK MAIN CONTROLLER v15 (Debug Edition)
 */

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
    trackEditMode: false
};

let audioCtx = null;
let masterGain = null;
let clockWorker = null;
let bassSynths = [];

let nextNoteTime = 0.0;
const LOOKAHEAD = 0.1;
const INTERVAL = 25;
let visualQueue = [];
let drawFrameId = null;
let lastDrawnStep = -1;

// --- BOOTSTRAP ---
function bootstrap() {
    window.logToScreen("Bootstrap started...");
    
    try {
        if(!window.timeMatrix) throw "TimeMatrix missing";
        if(typeof window.BassSynth === 'undefined') throw "BassSynth Class missing";

        // Setup Default Synth
        if(bassSynths.length === 0) {
            window.logToScreen("Creating default Bass-1");
            const defSynth = new window.BassSynth('bass-1');
            bassSynths.push(defSynth);
            window.timeMatrix.registerTrack('bass-1');
        }

        // Setup UI
        renderInstrumentTabs();
        renderTrackBar();
        updateEditors();
        
        window.logToScreen("Bootstrap Complete. Ready.");
    } catch(e) {
        window.logToScreen("Bootstrap Error: " + e, 'error');
    }
}

// --- AUDIO INIT ---
function initEngine() {
    if(audioCtx && audioCtx.state === 'running') return;
    
    window.logToScreen("Initializing Audio Engine...");
    try {
        if(!audioCtx) {
            const AC = window.AudioContext || window.webkitAudioContext;
            audioCtx = new AC({ latencyHint: 'interactive' });
            masterGain = audioCtx.createGain();
            masterGain.gain.value = 0.6;
            
            const comp = audioCtx.createDynamicsCompressor();
            comp.threshold.value = -3;
            masterGain.connect(comp);
            comp.connect(audioCtx.destination);

            // Connect Modules
            bassSynths.forEach(s => s.init(audioCtx, masterGain));
            if(window.drumSynth) window.drumSynth.init(audioCtx, masterGain);

            // Worker
            if(!clockWorker) {
                clockWorker = new Worker('Synth/clock_worker.js');
                clockWorker.onmessage = (e) => { if(e.data === "tick") scheduler(); };
                clockWorker.postMessage({interval: INTERVAL});
                window.logToScreen("Clock Worker Started");
            }
        }
        if(audioCtx.state === 'suspended') audioCtx.resume();
        window.logToScreen("Audio Engine Running");
    } catch(e) {
        window.logToScreen("Audio Init Failed: " + e, 'error');
    }
}

function globalUnlock() {
    initEngine();
    if(audioCtx && audioCtx.state === 'running') {
        document.removeEventListener('click', globalUnlock);
        document.removeEventListener('touchstart', globalUnlock);
    }
}

// --- CORE LOGIC ---
function addBassSynth() {
    const id = `bass-${bassSynths.length + 1}`;
    if(bassSynths.find(s=>s.id===id)) return;
    
    const s = new window.BassSynth(id);
    if(audioCtx) s.init(audioCtx, masterGain);
    bassSynths.push(s);
    window.timeMatrix.registerTrack(id);
    
    renderSynthMenu();
    renderInstrumentTabs();
    setTab(id);
}

function removeBassSynth(id) {
    if(bassSynths.length <= 1) return alert("Min 1 synth required");
    if(confirm(`Remove ${id}?`)) {
        bassSynths = bassSynths.filter(s=>s.id!==id);
        window.timeMatrix.removeTrack(id);
        if(AppState.activeView===id) AppState.activeView = bassSynths[0].id;
        renderSynthMenu();
        renderInstrumentTabs();
        updateEditors();
    }
}

// --- SCHEDULER ---
function nextNote() {
    const secPerBeat = 60.0 / AppState.bpm;
    const secPerStep = secPerBeat / 4;
    nextNoteTime += secPerStep;
    
    AppState.currentPlayStep++;
    if(AppState.currentPlayStep >= window.timeMatrix.totalSteps) {
        AppState.currentPlayStep = 0;
        AppState.currentPlayBlock++;
        if(AppState.currentPlayBlock >= window.timeMatrix.blocks.length) AppState.currentPlayBlock = 0;
    }
}

function scheduleNote(step, block, time) {
    visualQueue.push({ step, block, time });
    
    const data = window.timeMatrix.getStepData(step, block);
    
    // Drums
    if(data.drums && window.drumSynth) {
        data.drums.forEach(id => window.drumSynth.play(id, time));
    }
    
    // Bass
    if(data.tracks) {
        Object.keys(data.tracks).forEach(tid => {
            const n = data.tracks[tid][step];
            if(n) {
                const s = bassSynths.find(sy => sy.id === tid);
                if(s) s.play(n.note, n.octave, time, 0.25);
            }
        });
    }
}

function scheduler() {
    while(nextNoteTime < audioCtx.currentTime + LOOKAHEAD) {
        scheduleNote(AppState.currentPlayStep, AppState.currentPlayBlock, nextNoteTime);
        nextNote();
    }
}

function drawLoop() {
    const t = audioCtx.currentTime;
    while(visualQueue.length && visualQueue[0].time <= t) {
        const ev = visualQueue.shift();
        if(ev.step === 0) renderTrackBar();
        
        if(ev.block === AppState.editingBlock) {
            if(lastDrawnStep !== ev.step) {
                window.timeMatrix.highlightPlayingStep(ev.step);
                if(ev.step % 4 === 0) blinkLed();
                lastDrawnStep = ev.step;
            }
        } else {
            window.timeMatrix.highlightPlayingStep(-1);
        }
    }
    if(AppState.isPlaying) requestAnimationFrame(drawLoop);
}

function blinkLed() {
    const led = document.getElementById('activity-led');
    if(led) {
        led.classList.add('bg-white', 'shadow-white');
        setTimeout(() => led.classList.remove('bg-white', 'shadow-white'), 50);
    }
}

// --- UI ---
function renderInstrumentTabs() {
    const c = document.getElementById('instrument-tabs-container');
    if(!c) return;
    c.innerHTML = '';
    
    bassSynths.forEach(s => {
        const b = document.createElement('button');
        const active = AppState.activeView === s.id;
        b.className = `flex-1 py-2 px-4 text-xs font-bold rounded border uppercase ${active ? 'text-green-400 bg-gray-800 border-green-900' : 'text-gray-500 border-transparent'}`;
        b.innerText = s.id;
        b.onclick = () => setTab(s.id);
        c.appendChild(b);
    });
    
    const d = document.createElement('button');
    const dActive = AppState.activeView === 'drum';
    d.className = `flex-1 py-2 px-4 text-xs font-bold rounded border uppercase ${dActive ? 'text-green-400 bg-gray-800 border-green-900' : 'text-gray-500 border-transparent'}`;
    d.innerText = "DRUMS";
    d.onclick = () => setTab('drum');
    c.appendChild(d);
}

function setTab(v) {
    AppState.activeView = v;
    renderInstrumentTabs();
    updateEditors();
    const s = bassSynths.find(sy=>sy.id===v);
    if(s) document.getElementById('dist-slider').value = s.params.distortion;
}

function renderTrackBar() {
    const c = document.getElementById('track-bar');
    if(!c) return;
    c.innerHTML = '';
    const blocks = window.timeMatrix.blocks;
    document.getElementById('display-total-blocks').innerText = blocks.length;
    document.getElementById('display-current-block').innerText = AppState.editingBlock + 1;
    
    blocks.forEach((_, i) => {
        const el = document.createElement('div');
        el.className = `track-block ${i===AppState.editingBlock ? 'track-block-editing' : ''} ${AppState.isPlaying && i===AppState.currentPlayBlock ? 'track-block-playing' : ''}`;
        el.innerText = i + 1;
        el.onclick = () => { AppState.editingBlock = i; updateEditors(); renderTrackBar(); };
        c.appendChild(el);
    });
}

function updateEditors() {
    const bEd = document.getElementById('editor-bass');
    const dEd = document.getElementById('editor-drum');
    const info = document.getElementById('step-info-display');
    if(info) info.innerText = `STEP ${AppState.selectedStep+1} // ${AppState.activeView.toUpperCase()}`;
    
    if(AppState.activeView === 'drum') {
        bEd.classList.add('hidden'); dEd.classList.remove('hidden'); renderDrumRows();
    } else {
        bEd.classList.remove('hidden'); dEd.classList.add('hidden');
    }
    window.timeMatrix.selectedStep = AppState.selectedStep;
    window.timeMatrix.render(AppState.activeView, AppState.editingBlock);
}

function renderDrumRows() {
    const c = document.getElementById('editor-drum');
    if(!c) return;
    c.innerHTML = '';
    const blk = window.timeMatrix.blocks[AppState.editingBlock];
    const cur = blk.drums[AppState.selectedStep];
    
    window.drumSynth.kits.forEach(k => {
        const act = cur.includes(k.id);
        const b = document.createElement('button');
        b.className = `w-full py-3 px-4 mb-2 rounded border flex justify-between items-center font-bold ${act ? 'bg-gray-800 border-green-500 text-green-400' : 'bg-transparent border-gray-700 text-gray-500'}`;
        b.innerHTML = `<span>${k.name}</span><div class="w-3 h-3 rounded-full" style="background:${k.color}"></div>`;
        b.onclick = () => {
            initEngine();
            if(act) { cur.splice(cur.indexOf(k.id), 1); } else { cur.push(k.id); window.drumSynth.play(k.id, audioCtx.currentTime); }
            updateEditors();
        };
        c.appendChild(b);
    });
}

function renderSynthMenu() {
    const c = document.getElementById('synth-list-container');
    if(!c) return;
    c.innerHTML = '';
    bassSynths.forEach(s => {
        const r = document.createElement('div');
        r.className = 'flex justify-between bg-black p-2 rounded border border-gray-800';
        r.innerHTML = `<span class="text-xs text-green-500">${s.id}</span><button class="text-[10px] text-red-500" onclick="removeBassSynth('${s.id}')">DEL</button>`;
        c.appendChild(r);
    });
}

// --- TRANSPORT ---
function toggleTransport() {
    initEngine();
    AppState.isPlaying = !AppState.isPlaying;
    const btn = document.getElementById('btn-play');
    const icon = btn ? btn.querySelector('svg') : null;
    
    if(AppState.isPlaying) {
        if(btn) { btn.classList.add('border-green-500', 'shadow-[0_0_20px_#00ff41]'); icon.classList.add('text-green-500'); }
        AppState.currentPlayStep = 0;
        AppState.currentPlayBlock = AppState.editingBlock;
        nextNoteTime = audioCtx.currentTime + 0.1;
        visualQueue = [];
        if(clockWorker) clockWorker.postMessage("start");
        drawLoop();
        window.logToScreen("Transport: PLAY");
    } else {
        if(btn) { btn.classList.remove('border-green-500', 'shadow-[0_0_20px_#00ff41]'); icon.classList.remove('text-green-500'); }
        if(clockWorker) clockWorker.postMessage("stop");
        cancelAnimationFrame(drawFrameId);
        window.timeMatrix.highlightPlayingStep(-1);
        renderTrackBar();
        window.logToScreen("Transport: STOP");
    }
}

// --- SETUP ---
document.addEventListener('DOMContentLoaded', () => {
    bootstrap();
    
    document.addEventListener('click', globalUnlock);
    document.addEventListener('touchstart', globalUnlock);
    
    document.getElementById('btn-play').onclick = toggleTransport;
    const menu = document.getElementById('main-menu');
    const tMenu = () => { menu.classList.toggle('hidden'); menu.classList.toggle('flex'); };
    document.getElementById('btn-open-menu').onclick = () => { renderSynthMenu(); tMenu(); };
    document.getElementById('btn-menu-close').onclick = tMenu;
    
    document.getElementById('btn-add-synth').onclick = addBassSynth;
    document.getElementById('btn-menu-panic').onclick = () => location.reload();
    document.getElementById('btn-menu-clear').onclick = () => { if(confirm("Clear?")) { window.timeMatrix.clearBlock(AppState.editingBlock); updateEditors(); tMenu(); }};
    
    document.getElementById('btn-add-block').onclick = () => { window.timeMatrix.addBlock(); AppState.editingBlock = window.timeMatrix.blocks.length-1; updateEditors(); renderTrackBar(); };
    document.getElementById('btn-del-block').onclick = () => { if(confirm("Del?")) { window.timeMatrix.removeBlock(AppState.editingBlock); AppState.editingBlock = Math.max(0, window.timeMatrix.blocks.length-1); updateEditors(); renderTrackBar(); }};
    
    document.getElementById('btn-dock-mode').onclick = () => {
        const p = document.getElementById('editor-panel');
        p.classList.toggle('panel-docked'); p.classList.toggle('panel-overlay');
        const ph = document.getElementById('dock-placeholder');
        if(p.classList.contains('panel-docked')) ph.appendChild(p); else document.body.appendChild(p);
        lucide.createIcons();
    };
    
    // Matrix Tap
    window.addEventListener('stepSelect', (e) => {
        AppState.selectedStep = e.detail.index;
        updateEditors();
        const s = bassSynths.find(sy => sy.id === AppState.activeView);
        if(s && audioCtx) {
            const tracks = window.timeMatrix.blocks[AppState.editingBlock].tracks;
            if(tracks[s.id] && tracks[s.id][AppState.selectedStep]) {
                const n = tracks[s.id][AppState.selectedStep];
                s.play(n.note, n.octave, audioCtx.currentTime);
            }
        }
    });
    
    // Piano
    document.querySelectorAll('.piano-key').forEach(k => {
        k.onclick = () => {
            initEngine();
            const note = k.dataset.note;
            const s = bassSynths.find(sy => sy.id === AppState.activeView);
            if(!s) return;
            const b = window.timeMatrix.blocks[AppState.editingBlock];
            if(!b.tracks[s.id]) window.timeMatrix.registerTrack(s.id);
            b.tracks[s.id][AppState.selectedStep] = { note, octave: AppState.currentOctave };
            s.play(note, AppState.currentOctave, audioCtx.currentTime);
            updateEditors();
        };
    });
    
    document.getElementById('btn-delete-note').onclick = () => {
        const s = bassSynths.find(sy => sy.id === AppState.activeView);
        if(s) { window.timeMatrix.blocks[AppState.editingBlock].tracks[s.id][AppState.selectedStep] = null; updateEditors(); }
    };
    
    // Params
    document.getElementById('bpm-input').onchange = (e) => AppState.bpm = e.target.value;
    const octD = document.getElementById('oct-display');
    document.getElementById('oct-up').onclick = () => { if(AppState.currentOctave<6) AppState.currentOctave++; octD.innerText=AppState.currentOctave; };
    document.getElementById('oct-down').onclick = () => { if(AppState.currentOctave>1) AppState.currentOctave--; octD.innerText=AppState.currentOctave; };
    document.getElementById('dist-slider').oninput = (e) => {
        const v = parseInt(e.target.value);
        const s = bassSynths.find(sy => sy.id === AppState.activeView);
        if(s) s.setDistortion(v);
    };
    
    lucide.createIcons();
});