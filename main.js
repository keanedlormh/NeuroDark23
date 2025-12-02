/*
 * NEURODARK MAIN CONTROLLER v20 (Diagnostic Edition)
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

// --- CLOCK UI ---
function initPlayClock() {
    const svg = document.getElementById('play-clock-svg');
    if(!svg) return;
    const steps = window.timeMatrix.totalSteps || 16;
    const radius = 45; 
    const center = 50;
    const circumference = 2 * Math.PI * radius;
    const gap = 2; 
    const dash = (circumference / steps) - gap;
    svg.innerHTML = ''; 
    for(let i=0; i<steps; i++) {
        const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        c.setAttribute("r", radius); c.setAttribute("cx", center); c.setAttribute("cy", center);
        c.setAttribute("fill", "transparent"); c.setAttribute("stroke-width", "4");
        c.setAttribute("stroke-dasharray", `${dash} ${circumference - dash}`);
        const angle = (360 / steps) * i;
        c.setAttribute("transform", `rotate(${angle}, ${center}, ${center})`);
        c.setAttribute("id", `clock-seg-${i}`);
        c.setAttribute("stroke", "#333"); 
        svg.appendChild(c);
    }
}

function updatePlayClock(step) {
    const total = window.timeMatrix.totalSteps;
    for(let i=0; i<total; i++) {
        const seg = document.getElementById(`clock-seg-${i}`);
        if(!seg) continue;
        if (i === step) { seg.setAttribute("stroke", "#00ff41"); seg.setAttribute("opacity", "1"); } 
        else if (i < step) { seg.setAttribute("stroke", "#004411"); seg.setAttribute("opacity", "0.5"); } 
        else { seg.setAttribute("stroke", "#222"); seg.setAttribute("opacity", "0.3"); }
    }
}

// --- BOOTSTRAP ---
function bootstrap() {
    window.logToScreen("Checking Core Modules...");
    
    try {
        if(!window.timeMatrix) throw "CRITICAL: TimeMatrix not loaded.";
        if(typeof window.BassSynth === 'undefined') throw "CRITICAL: BassSynth Class not loaded.";

        window.logToScreen("Modules OK. Configuring...");

        // Ensure Default Synth
        if(bassSynths.length === 0) {
            const def = new window.BassSynth('bass-1');
            bassSynths.push(def);
            window.logToScreen("Default Bass-1 Created.");
            if(window.timeMatrix.registerTrack) window.timeMatrix.registerTrack('bass-1');
        }

        renderInstrumentTabs();
        renderTrackBar();
        updateEditors();
        initPlayClock();
        
        window.logToScreen("BOOTSTRAP COMPLETE. Waiting for Audio...");
    } catch(e) {
        window.logToScreen(e, 'error');
    }
}

// --- ENGINE INIT ---
function initEngine() {
    if(audioCtx && audioCtx.state === 'running') return;
    window.logToScreen("Attempting Audio Context Start...");
    
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

            bassSynths.forEach(s => s.init(audioCtx, masterGain));
            if(window.drumSynth) window.drumSynth.init(audioCtx, masterGain);

            if(!clockWorker) {
                try {
                    clockWorker = new Worker('Synth/clock_worker.js');
                    clockWorker.onmessage = (e) => { if(e.data === "tick") scheduler(); };
                    clockWorker.postMessage({interval: INTERVAL});
                    window.logToScreen("Worker Thread Started.");
                } catch(e) { window.logToScreen("Worker Failed: "+e, 'error'); }
            }
        }
        if(audioCtx.state === 'suspended') audioCtx.resume();
        window.logToScreen("AUDIO ENGINE RUNNING.");
    } catch(e) {
        window.logToScreen("Audio Init Crash: " + e, 'error');
    }
}

function globalUnlock() {
    initEngine();
    // One time unlock
    if(audioCtx && audioCtx.state === 'running') {
        document.removeEventListener('click', globalUnlock);
        document.removeEventListener('touchstart', globalUnlock);
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
    renderSynthMenu(); renderInstrumentTabs(); setTab(id);
    window.logToScreen(`New Synth Added: ${id}`);
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
    if(data.tracks) Object.keys(data.tracks).forEach(tid => {
        const n = data.tracks[tid][step];
        if(n) {
            const s = bassSynths.find(sy => sy.id === tid);
            if(s) s.play(n.note, n.octave, time, 0.25);
        }
    });
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
        if(lastDrawnStep !== ev.step) {
            updatePlayClock(ev.step);
            if(ev.block === AppState.editingBlock) {
                window.timeMatrix.highlightPlayingStep(ev.step);
                if(ev.step % 4 === 0) blinkLed();
            } else {
                window.timeMatrix.highlightPlayingStep(-1);
            }
            lastDrawnStep = ev.step;
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
        b.className = `px-3 py-1 text-[10px] font-bold border uppercase transition-all ${active ? 'text-green-400 bg-gray-900 border-green-500 shadow-md' : 'text-gray-500 border-transparent hover:text-gray-300'}`;
        b.innerText = s.id;
        b.onclick = () => setTab(s.id);
        c.appendChild(b);
    });
    const d = document.createElement('button');
    const dActive = AppState.activeView === 'drum';
    d.className = `px-3 py-1 text-[10px] font-bold border uppercase transition-all ${dActive ? 'text-green-400 bg-gray-900 border-green-500 shadow-md' : 'text-gray-500 border-transparent hover:text-gray-300'}`;
    d.innerText = "DRUMS";
    d.onclick = () => setTab('drum');
    c.appendChild(d);
}

function setTab(v) {
    window.logToScreen(`Switch View -> ${v}`);
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
    if(AppState.activeView === 'drum') { bEd.classList.add('hidden'); dEd.classList.remove('hidden'); renderDrumRows(); }
    else { bEd.classList.remove('hidden'); dEd.classList.add('hidden'); }
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
        b.className = `w-full py-2 px-3 mb-1 border flex justify-between items-center text-[10px] ${act ? 'bg-gray-900 border-green-500 text-green-400' : 'bg-transparent border-gray-800 text-gray-500'}`;
        b.innerHTML = `<span>${k.name}</span><div class="w-2 h-2 rounded-full" style="background:${k.color}"></div>`;
        b.onclick = () => {
            initEngine();
            if(act) { cur.splice(cur.indexOf(k.id), 1); window.logToScreen(`Drum OFF: ${k.id}`); } 
            else { cur.push(k.id); window.drumSynth.play(k.id, audioCtx.currentTime); window.logToScreen(`Drum ON: ${k.id}`); }
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
        r.className = 'flex justify-between bg-black p-2 border border-gray-800 text-xs mb-1';
        r.innerHTML = `<span class="text-green-500">${s.id}</span>`;
        c.appendChild(r);
    });
}

function toggleTransport() {
    initEngine();
    AppState.isPlaying = !AppState.isPlaying;
    const btn = document.getElementById('btn-play');
    const icon = btn.querySelector('svg');
    
    if(AppState.isPlaying) {
        btn.classList.add('border-green-500', 'text-green-500');
        if(icon) icon.innerHTML = '<rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect>';
        AppState.currentPlayStep = 0; AppState.currentPlayBlock = AppState.editingBlock;
        nextNoteTime = audioCtx.currentTime + 0.1; visualQueue = [];
        if(clockWorker) clockWorker.postMessage("start");
        drawLoop();
        window.logToScreen("PLAY");
    } else {
        btn.classList.remove('border-green-500', 'text-green-500');
        if(icon) icon.innerHTML = '<polygon points="5 3 19 12 5 21 5 3"></polygon>';
        if(clockWorker) clockWorker.postMessage("stop");
        cancelAnimationFrame(drawFrameId); window.timeMatrix.highlightPlayingStep(-1); updatePlayClock(-1);
        renderTrackBar();
        window.logToScreen("STOP");
    }
}

// --- SETUP ---
document.addEventListener('DOMContentLoaded', () => {
    bootstrap();
    
    document.addEventListener('click', globalUnlock);
    document.addEventListener('touchstart', globalUnlock);
    
    document.getElementById('btn-play').onclick = toggleTransport;
    
    const menu = document.getElementById('main-menu');
    const toggleMenu = () => { menu.classList.toggle('hidden'); menu.classList.toggle('flex'); };
    document.getElementById('btn-open-menu').onclick = () => { renderSynthMenu(); toggleMenu(); };
    document.getElementById('btn-menu-close').onclick = toggleMenu;
    
    // Log UI
    const logPanel = document.getElementById('sys-log-panel');
    const logBtn = document.getElementById('btn-toggle-log-internal');
    const logMenuBtn = document.getElementById('btn-toggle-log-menu');
    const toggleLog = () => {
        if(logPanel.style.transform === 'translateY(-100%)') {
            logPanel.style.transform = 'translateY(0)';
            logBtn.innerText = "[ HIDE LOG ]";
        } else {
            logPanel.style.transform = 'translateY(-100%)';
            logBtn.innerText = "[ SHOW LOG ]";
        }
    };
    logBtn.onclick = toggleLog;
    logMenuBtn.onclick = () => { toggleLog(); toggleMenu(); };

    // Synth/Track Actions
    document.getElementById('btn-add-synth').onclick = addBassSynth;
    document.getElementById('btn-menu-panic').onclick = () => location.reload();
    
    document.getElementById('btn-add-block').onclick = () => { window.timeMatrix.addBlock(); AppState.editingBlock = window.timeMatrix.blocks.length-1; updateEditors(); renderTrackBar(); };
    document.getElementById('btn-del-block').onclick = () => { if(confirm("Del?")) { window.timeMatrix.removeBlock(AppState.editingBlock); AppState.editingBlock = Math.max(0, window.timeMatrix.blocks.length-1); updateEditors(); renderTrackBar(); }};
    document.getElementById('btn-copy-block').onclick = () => { window.timeMatrix.duplicateBlock(AppState.editingBlock); AppState.editingBlock++; updateEditors(); renderTrackBar(); };
    document.getElementById('btn-move-left').onclick = () => { if(window.timeMatrix.moveBlock(AppState.editingBlock, -1)) { AppState.editingBlock--; updateEditors(); renderTrackBar(); }};
    document.getElementById('btn-move-right').onclick = () => { if(window.timeMatrix.moveBlock(AppState.editingBlock, 1)) { AppState.editingBlock++; updateEditors(); renderTrackBar(); }};

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
        // Visual Feedback Only
        window.logToScreen(`Step ${e.detail.index + 1} Selected`);
    });
    
    // Piano
    document.querySelectorAll('.piano-key').forEach(k => {
        k.onclick = () => {
            initEngine();
            const note = k.dataset.note;
            const s = bassSynths.find(sy => sy.id === AppState.activeView);
            if(!s) { window.logToScreen("No active synth for note input", "error"); return; }
            
            const b = window.timeMatrix.blocks[AppState.editingBlock];
            if(!b.tracks[s.id]) window.timeMatrix.registerTrack(s.id);
            
            // Record
            b.tracks[s.id][AppState.selectedStep] = { note, octave: AppState.currentOctave };
            // Play
            s.play(note, AppState.currentOctave, audioCtx.currentTime);
            updateEditors();
            window.logToScreen(`Rec Note: ${note}${AppState.currentOctave} on Step ${AppState.selectedStep+1}`);
        };
    });
    
    document.getElementById('btn-delete-note').onclick = () => {
        const s = bassSynths.find(sy => sy.id === AppState.activeView);
        if(s) { window.timeMatrix.blocks[AppState.editingBlock].tracks[s.id][AppState.selectedStep] = null; updateEditors(); window.logToScreen("Note Cleared"); }
    };
    
    // Octave
    const octD = document.getElementById('oct-display');
    document.getElementById('oct-up').onclick = () => { if(AppState.currentOctave<6) AppState.currentOctave++; octD.innerText=AppState.currentOctave; };
    document.getElementById('oct-down').onclick = () => { if(AppState.currentOctave>1) AppState.currentOctave--; octD.innerText=AppState.currentOctave; };
    
    lucide.createIcons();
});