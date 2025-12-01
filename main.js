/*
 * NEURODARK MAIN CONTROLLER v17 (Native)
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
    panelMode: 'docked'
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
    window.logToScreen("Bootstrap init...");
    try {
        if(!window.timeMatrix) throw "TimeMatrix Missing";
        if(typeof window.BassSynth === 'undefined') throw "BassSynth Class Missing";

        // Default Synth
        if(bassSynths.length === 0) {
            const def = new window.BassSynth('bass-1');
            bassSynths.push(def);
            if(window.timeMatrix.registerTrack) window.timeMatrix.registerTrack('bass-1');
        }

        renderInstrumentTabs();
        renderTrackBar();
        updateEditors();
        window.logToScreen("System Ready.");
    } catch(e) {
        window.logToScreen("BOOT FAIL: " + e, 'error');
    }
}

// --- AUDIO INIT ---
function initEngine() {
    if(audioCtx && audioCtx.state === 'running') return;
    window.logToScreen("Starting Audio Engine...");
    
    try {
        if(!audioCtx) {
            const AC = window.AudioContext || window.webkitAudioContext;
            audioCtx = new AC({ latencyHint: 'interactive' });
            masterGain = audioCtx.createGain();
            masterGain.gain.value = 0.6;
            
            // Limitador
            const comp = audioCtx.createDynamicsCompressor();
            comp.threshold.value = -3;
            masterGain.connect(comp);
            comp.connect(audioCtx.destination);

            bassSynths.forEach(s => s.init(audioCtx, masterGain));
            if(window.drumSynth) window.drumSynth.init(audioCtx, masterGain);

            if(!clockWorker) {
                try {
                    clockWorker = new Worker('Synth/clock_worker.js');
                    clockWorker.onmessage = (e) => { if(e.data === "tick") scheduler(); };
                    clockWorker.postMessage({interval: INTERVAL});
                } catch(e) { window.logToScreen("Worker Error: "+e, 'error'); }
            }
        }
        if(audioCtx.state === 'suspended') audioCtx.resume();
        window.logToScreen("Audio Active.");
    } catch(e) {
        window.logToScreen("Audio Init Fail: " + e, 'error');
    }
}

// --- CORE ---
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
    window.logToScreen(`Added ${id}`);
}

function removeBassSynth(id) {
    if(bassSynths.length <= 1) return alert("Min 1 synth.");
    if(confirm(`Del ${id}?`)) {
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
    if(data.drums && window.drumSynth) data.drums.forEach(id => window.drumSynth.play(id, time));
    
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
        if(ev.step === 0) renderTrackBar(); // Update bar on beat 1
        
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
        led.style.backgroundColor = '#fff';
        led.style.boxShadow = '0 0 8px #fff';
        setTimeout(() => { 
            led.style.backgroundColor = ''; 
            led.style.boxShadow = '';
        }, 50);
    }
}

// --- UI UPDATE (Sync) ---
function renderInstrumentTabs() {
    const c = document.getElementById('instrument-tabs-container');
    if(!c) return;
    c.innerHTML = '';
    
    bassSynths.forEach(s => {
        const b = document.createElement('button');
        const active = AppState.activeView === s.id;
        b.className = `px-3 py-1 text-[10px] font-bold border uppercase ${active ? 'text-green-400 bg-gray-900 border-green-700' : 'text-gray-500 border-transparent'}`;
        b.innerText = s.id;
        b.onclick = () => setTab(s.id);
        c.appendChild(b);
    });
    
    const d = document.createElement('button');
    const dActive = AppState.activeView === 'drum';
    d.className = `px-3 py-1 text-[10px] font-bold border uppercase ${dActive ? 'text-green-400 bg-gray-900 border-green-700' : 'text-gray-500 border-transparent'}`;
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
    
    const kits = (window.drumSynth && window.drumSynth.kits) ? window.drumSynth.kits : [];
    kits.forEach(k => {
        const act = cur.includes(k.id);
        const b = document.createElement('button');
        b.className = `w-full py-2 px-3 mb-1 border flex justify-between items-center text-[10px] ${act ? 'bg-gray-900 border-green-700 text-green-400' : 'bg-transparent border-gray-800 text-gray-500'}`;
        b.innerHTML = `<span>${k.name}</span><div class="w-2 h-2 rounded-full" style="background:${k.color}"></div>`;
        b.onclick = () => {
            initEngine();
            if(act) cur.splice(cur.indexOf(k.id), 1); else { cur.push(k.id); window.drumSynth.play(k.id, audioCtx.currentTime); }
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
        r.className = 'flex justify-between bg-black p-2 border border-gray-800 text-xs';
        r.innerHTML = `<span class="text-green-500">${s.id}</span><button class="text-red-500" onclick="removeBassSynth('${s.id}')">X</button>`;
        c.appendChild(r);
    });
}

function toggleTransport() {
    initEngine();
    AppState.isPlaying = !AppState.isPlaying;
    const btn = document.getElementById('btn-play');
    
    if(AppState.isPlaying) {
        btn.innerHTML = "&#10074;&#10074;"; // Pause char
        btn.classList.add('border-green-500', 'text-green-500');
        
        AppState.currentPlayStep = 0;
        AppState.currentPlayBlock = AppState.editingBlock;
        nextNoteTime = audioCtx.currentTime + 0.1;
        visualQueue = [];
        if(clockWorker) clockWorker.postMessage("start");
        drawLoop();
        window.logToScreen("PLAY");
    } else {
        btn.innerHTML = "&#9658;"; // Play char
        btn.classList.remove('border-green-500', 'text-green-500');
        
        if(clockWorker) clockWorker.postMessage("stop");
        cancelAnimationFrame(drawFrameId);
        window.timeMatrix.highlightPlayingStep(-1);
        renderTrackBar();
        window.logToScreen("STOP");
    }
}

// --- SETUP ---
document.addEventListener('DOMContentLoaded', () => {
    bootstrap();
    
    // Unlock on interaction
    const unlock = () => { initEngine(); document.removeEventListener('click', unlock); document.removeEventListener('touchstart', unlock); };
    document.addEventListener('click', unlock);
    document.addEventListener('touchstart', unlock);
    
    // UI Events
    document.getElementById('btn-play').onclick = toggleTransport;
    
    const menu = document.getElementById('main-menu');
    const toggleMenu = () => { menu.classList.toggle('hidden'); menu.classList.toggle('flex'); };
    document.getElementById('btn-open-menu').onclick = () => { renderSynthMenu(); toggleMenu(); };
    document.getElementById('btn-menu-close').onclick = toggleMenu;
    
    // Log Panel
    const logPanel = document.getElementById('sys-log-panel');
    const logToggle = document.getElementById('btn-toggle-log-internal');
    const logMenuBtn = document.getElementById('btn-toggle-log-menu');
    
    const toggleLog = () => {
        if(logPanel.style.transform === 'translateY(-100%)') {
            logPanel.style.transform = 'translateY(0)';
            logToggle.innerText = "[HIDE]";
        } else {
            logPanel.style.transform = 'translateY(-100%)';
            logToggle.innerText = "[SHOW]";
        }
    };
    logToggle.onclick = toggleLog;
    logMenuBtn.onclick = () => { toggleLog(); toggleMenu(); };

    // Synth
    document.getElementById('btn-add-synth').onclick = addBassSynth;
    document.getElementById('btn-menu-panic').onclick = () => location.reload();
    document.getElementById('btn-menu-clear').onclick = () => { if(confirm("Clear?")) { window.timeMatrix.clearBlock(AppState.editingBlock); updateEditors(); toggleMenu(); }};
    
    // Track
    document.getElementById('btn-add-block').onclick = () => { window.timeMatrix.addBlock(); AppState.editingBlock = window.timeMatrix.blocks.length-1; updateEditors(); renderTrackBar(); };
    document.getElementById('btn-del-block').onclick = () => { if(confirm("Del?")) { window.timeMatrix.removeBlock(AppState.editingBlock); AppState.editingBlock = Math.max(0, window.timeMatrix.blocks.length-1); updateEditors(); renderTrackBar(); }};
    
    // Dock
    document.getElementById('btn-dock-mode').onclick = () => {
        const p = document.getElementById('editor-panel');
        p.classList.toggle('panel-docked'); p.classList.toggle('panel-overlay');
        const ph = document.getElementById('dock-placeholder');
        // Native icon swap
        const btn = document.getElementById('btn-dock-mode');
        if(p.classList.contains('panel-docked')) { ph.appendChild(p); btn.innerHTML = "&#9633;"; } 
        else { document.body.appendChild(p); btn.innerHTML = "_"; }
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
});