/*
 * NEURODARK 23 - NATIVE CORE v22 (Filters)
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
    panelCollapsed: false,
    followPlayback: false, 
    uiMode: 'analog',
    exportReps: 1
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

// --- UTILS ---
function safeClick(id, fn) {
    const el = document.getElementById(id);
    if(el) el.onclick = fn;
    else console.warn(`Button ID not found: ${id}`);
}

// --- BOOTSTRAP ---
function bootstrap() {
    window.logToScreen("Boot Filters...");
    try {
        if(!window.timeMatrix) throw "TimeMatrix Missing";
        if(typeof window.BassSynth === 'undefined') throw "BassSynth Missing";

        if(bassSynths.length === 0) {
            const def = new window.BassSynth('bass-1');
            bassSynths.push(def);
            if(window.timeMatrix.registerTrack) window.timeMatrix.registerTrack('bass-1');
        }

        renderInstrumentTabs();
        renderTrackBar();
        updateEditors();
        initPlayClock();
        
    } catch(e) {
        window.logToScreen("BOOT ERR: " + e, 'error');
    }
}

// --- ENGINE ---
function initEngine() {
    if(audioCtx && audioCtx.state === 'running') return;
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
                } catch(e) { console.warn(e); }
            }
        }
        if(audioCtx.state === 'suspended') audioCtx.resume();
    } catch(e) { window.logToScreen("Audio Fail: "+e, 'error'); }
}

function globalUnlock() {
    initEngine();
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
    window.logToScreen(`+Synth: ${id}`);
}

// --- EXPORT ---
async function renderAudio() {
    if(AppState.isPlaying) toggleTransport();
    window.logToScreen("Rendering WAV...");
    const btn = document.getElementById('btn-start-render');
    if(btn) { btn.innerText = "WAIT..."; btn.disabled = true; }

    try {
        const stepsPerBlock = window.timeMatrix.totalSteps;
        const totalBlocks = window.timeMatrix.blocks.length;
        const secPerStep = (60.0 / AppState.bpm) / 4;
        const totalSteps = stepsPerBlock * totalBlocks * AppState.exportReps;
        const duration = totalSteps * secPerStep + 2.0;

        const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        const offCtx = new OfflineCtx(2, 44100 * duration, 44100);
        
        const offMaster = offCtx.createGain();
        offMaster.gain.value = 0.6;
        offMaster.connect(offCtx.destination);

        const offBass = [];
        bassSynths.forEach(ls => {
            const s = new window.BassSynth(ls.id);
            s.init(offCtx, offMaster);
            s.setDistortion(ls.params.distortion);
            s.setCutoff(ls.params.cutoff);
            s.setResonance(ls.params.resonance);
            s.setWaveform(ls.params.waveform); // Sincronizar waveform en exportación
            offBass.push(s);
        });
        const offDrum = new DrumSynth();
        offDrum.init(offCtx, offMaster);

        let t = 0.0;
        for(let r=0; r<AppState.exportReps; r++) {
            for(let b=0; b<totalBlocks; b++) {
                const blk = window.timeMatrix.blocks[b];
                for(let s=0; s<stepsPerBlock; s++) {
                    if(blk.drums[s]) blk.drums[s].forEach(id=>offDrum.play(id, t));
                    if(blk.tracks) Object.keys(blk.tracks).forEach(tid => {
                        const n = blk.tracks[tid][s];
                        if(n) {
                            const syn = offBass.find(k=>k.id===tid);
                            if(syn) syn.play(n.note, n.octave, t, 0.25, n.slide, n.accent);
                        }
                    });
                    t += secPerStep;
                }
            }
        }

        const buf = await offCtx.startRendering();
        const wav = bufferToWave(buf, buf.length);
        const url = URL.createObjectURL(wav);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ND23_Render_${Date.now()}.wav`;
        a.click();
        window.logToScreen("Download Ready!");
        toggleExportModal();

    } catch(e) { window.logToScreen("Render Err: "+e, 'error'); }
    finally { if(btn) { btn.innerText = "RENDER"; btn.disabled = false; } }
}

function bufferToWave(abuffer, len) {
    let numOfChan = abuffer.numberOfChannels,
        length = len * numOfChan * 2 + 44,
        buffer = new ArrayBuffer(length),
        view = new DataView(buffer),
        channels = [], i, sample,
        offset = 0, pos = 0;

    function setUint16(data) { view.setUint16(pos, data, true); pos += 2; }
    function setUint32(data) { view.setUint32(pos, data, true); pos += 4; }

    setUint32(0x46464952); setUint32(length - 8); setUint32(0x45564157);
    setUint32(0x20746d66); setUint32(16); setUint16(1); setUint16(numOfChan);
    setUint32(abuffer.sampleRate); setUint32(abuffer.sampleRate * 2 * numOfChan);
    setUint16(numOfChan * 2); setUint16(16); setUint32(0x61746164);
    setUint32(length - pos - 4);

    for(i = 0; i < numOfChan; i++) channels.push(abuffer.getChannelData(i));

    while(pos < length) {
        for(i = 0; i < numOfChan; i++) {
            sample = Math.max(-1, Math.min(1, channels[i][offset])); 
            sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767)|0; 
            view.setInt16(pos, sample, true); pos += 2;
        }
        offset++;
    }
    return new Blob([buffer], {type: "audio/wav"});
}

// --- CLOCK ---
function initPlayClock() {
    const svg = document.getElementById('play-clock-svg');
    if(!svg) return;
    const steps = window.timeMatrix.totalSteps || 16;
    const r=45, c=50, circ=2*Math.PI*r, gap=2, dash=(circ/steps)-gap;
    svg.innerHTML = ''; 
    for(let i=0; i<steps; i++) {
        const el = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        el.setAttribute("r", r); el.setAttribute("cx", c); el.setAttribute("cy", c);
        el.setAttribute("fill", "transparent"); el.setAttribute("stroke-width", "4");
        el.setAttribute("stroke-dasharray", `${dash} ${circ - dash}`);
        el.setAttribute("transform", `rotate(${(360/steps)*i}, ${c}, ${c})`);
        el.setAttribute("id", `clock-seg-${i}`);
        el.setAttribute("stroke", "#333"); 
        svg.appendChild(el);
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
            if(s) s.play(n.note, n.octave, time, 0.25, n.slide, n.accent);
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
            
            // --- NUEVA LÓGICA DE VISUALIZACIÓN ---
            if(AppState.followPlayback && ev.block !== AppState.editingBlock) {
                AppState.editingBlock = ev.block;
                updateEditors();
                renderTrackBar();
            }

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
        led.style.backgroundColor = '#fff';
        led.style.boxShadow = '0 0 8px #fff';
        setTimeout(() => { led.style.backgroundColor = ''; led.style.boxShadow = ''; }, 50);
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
    AppState.activeView = v;
    renderInstrumentTabs();
    updateEditors();
    syncControlsFromSynth(v);
}

// --- NEW UI SYNC ---
function syncControlsFromSynth(viewId) {
    const s = bassSynths.find(sy => sy.id === viewId);
    
    // Waveform Btn Sync
    const wvBtn = document.getElementById('btn-waveform');
    if(wvBtn && s) {
        if(s.params.waveform === 'square') {
            wvBtn.innerHTML = '<span class="text-xl font-bold leading-none mb-1">Π</span><span>SQR</span>';
        } else {
            wvBtn.innerHTML = '<span class="text-xl font-bold leading-none mb-1">~</span><span>SAW</span>';
        }
    }

    if(!s) return;
    
    // ANALOG DOM
    const slDist = document.getElementById('dist-slider');
    const slCut = document.getElementById('cutoff-slider');
    const slRes = document.getElementById('res-slider');

    // DIGITAL DOM
    const digDist = document.getElementById('dist-digital');
    const digCut = document.getElementById('cutoff-digital');
    const digRes = document.getElementById('res-digital');

    // MAPPINGS
    const cutPerc = Math.round(((s.params.cutoff - 100) / 4900) * 100);
    const resPerc = Math.round(s.params.resonance * 5);

    // UPDATE UI
    if(slDist) slDist.value = s.params.distortion;
    if(slCut) slCut.value = s.params.cutoff;
    if(slRes) slRes.value = s.params.resonance;

    if(digDist) digDist.value = s.params.distortion;
    if(digCut) digCut.value = Math.max(0, Math.min(100, cutPerc));
    if(digRes) digRes.value = Math.max(0, Math.min(100, resPerc));
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
    
    // UPDATE BUTTON STATES (Slide/Accent)
    const slideBtn = document.getElementById('btn-toggle-slide');
    const accBtn = document.getElementById('btn-toggle-accent');
    
    if(slideBtn) slideBtn.classList.remove('text-green-400', 'border-green-600');
    if(accBtn) accBtn.classList.remove('text-green-400', 'border-green-600');

    if(AppState.activeView !== 'drum') {
         const blk = window.timeMatrix.blocks[AppState.editingBlock];
         const noteData = blk.tracks[AppState.activeView] ? blk.tracks[AppState.activeView][AppState.selectedStep] : null;
         
         if(noteData) {
             if(noteData.slide && slideBtn) slideBtn.classList.add('text-green-400', 'border-green-600');
             if(noteData.accent && accBtn) accBtn.classList.add('text-green-400', 'border-green-600');
         }
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
        b.onclick = () => { initEngine(); if(act) cur.splice(cur.indexOf(k.id), 1); else { cur.push(k.id); window.drumSynth.play(k.id, audioCtx.currentTime); } updateEditors(); };
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
        btn.innerHTML = "&#10074;&#10074;";
        btn.classList.add('border-green-500', 'text-green-500');
        AppState.currentPlayStep = 0; AppState.currentPlayBlock = AppState.editingBlock;
        nextNoteTime = audioCtx.currentTime + 0.1; visualQueue = [];
        if(clockWorker) clockWorker.postMessage("start");
        drawLoop();
        window.logToScreen("PLAY");
    } else {
        btn.innerHTML = "&#9658;";
        btn.classList.remove('border-green-500', 'text-green-500');
        if(clockWorker) clockWorker.postMessage("stop");
        cancelAnimationFrame(drawFrameId); window.timeMatrix.highlightPlayingStep(-1); updatePlayClock(-1);
        renderTrackBar(); window.logToScreen("STOP");
    }
}

function toggleUIMode() {
    AppState.uiMode = AppState.uiMode === 'analog' ? 'digital' : 'analog';
    const btn = document.getElementById('btn-toggle-ui-mode');
    const analogP = document.getElementById('fx-controls-analog');
    const digitalP = document.getElementById('fx-controls-digital');
    
    if(AppState.uiMode === 'digital') {
        btn.innerText = "UI MODE: DIGITAL";
        btn.classList.add('border-green-500', 'text-green-300');
        analogP.classList.add('opacity-0', 'pointer-events-none');
        digitalP.classList.remove('hidden');
    } else {
        btn.innerText = "UI MODE: ANALOG";
        btn.classList.remove('border-green-500', 'text-green-300');
        analogP.classList.remove('opacity-0', 'pointer-events-none');
        digitalP.classList.add('hidden');
    }
    syncControlsFromSynth(AppState.activeView);
}

function toggleVisualizerMode() {
    AppState.followPlayback = !AppState.followPlayback;
    const btn = document.getElementById('btn-toggle-visualizer');
    if(AppState.followPlayback) {
        btn.innerText = "VISUALIZER: ON";
        btn.classList.remove('border-gray-700', 'text-gray-400');
        btn.classList.add('border-green-500', 'text-green-400', 'bg-green-900/20');
    } else {
        btn.innerText = "VISUALIZER: OFF";
        btn.classList.remove('border-green-500', 'text-green-400', 'bg-green-900/20');
        btn.classList.add('border-gray-700', 'text-gray-400');
    }
}

// TOGGLE PANEL
function togglePanelState() {
    AppState.panelCollapsed = !AppState.panelCollapsed;
    const p = document.getElementById('editor-panel');
    const btn = document.getElementById('btn-minimize-panel');
    
    if(AppState.panelCollapsed) {
        // COLAPSAR
        p.classList.remove('panel-expanded');
        p.classList.add('panel-collapsed');
        btn.innerHTML = "&#9650;"; 
    } else {
        // EXPANDIR
        p.classList.remove('panel-collapsed');
        p.classList.add('panel-expanded');
        btn.innerHTML = "&#9660;"; 
    }
}

function toggleWaveform() {
    const s = bassSynths.find(sy => sy.id === AppState.activeView);
    if(s) {
        const next = s.params.waveform === 'sawtooth' ? 'square' : 'sawtooth';
        s.setWaveform(next);
        syncControlsFromSynth(AppState.activeView);
    }
}

// --- MODALS ---
function toggleMenu() { const m=document.getElementById('main-menu'); m.classList.toggle('hidden'); m.classList.toggle('flex'); }
function toggleExportModal() { const m=document.getElementById('export-modal'); m.classList.toggle('hidden'); m.classList.toggle('flex'); }

// --- SETUP ---
document.addEventListener('DOMContentLoaded', () => {
    bootstrap();
    
    document.addEventListener('click', globalUnlock);
    document.addEventListener('touchstart', globalUnlock);
    
    safeClick('btn-play', toggleTransport);
    safeClick('app-logo', toggleTransport); 
    
    safeClick('btn-open-menu', () => { renderSynthMenu(); toggleMenu(); });
    safeClick('btn-menu-close', toggleMenu);
    
    // Toggle UI Modes
    safeClick('btn-toggle-ui-mode', toggleUIMode);
    safeClick('btn-toggle-visualizer', toggleVisualizerMode);

    // Toggle Panel
    safeClick('btn-minimize-panel', (e) => { e.stopPropagation(); togglePanelState(); });
    safeClick('panel-header-trigger', togglePanelState);

    // WAVEFORM TOGGLE
    safeClick('btn-waveform', toggleWaveform);

    // Log
    const logPanel = document.getElementById('sys-log-panel');
    const logBtn = document.getElementById('btn-toggle-log-internal');
    const toggleLog = () => {
        if(logPanel.style.transform === 'translateY(-100%)') { logPanel.style.transform = 'translateY(0)'; logBtn.innerText = "[HIDE]"; }
        else { logPanel.style.transform = 'translateY(-100%)'; logBtn.innerText = "[SHOW]"; }
    };
    if(logBtn) logBtn.onclick = toggleLog;
    safeClick('btn-toggle-log-menu', () => { toggleLog(); toggleMenu(); });

    // Synth Actions
    safeClick('btn-add-synth', addBassSynth);
    safeClick('btn-menu-panic', () => location.reload());
    safeClick('btn-menu-clear', () => { if(confirm("Clear?")) { window.timeMatrix.clearBlock(AppState.editingBlock); updateEditors(); toggleMenu(); }});
    
    // Track Actions
    safeClick('btn-add-block', () => { window.timeMatrix.addBlock(); AppState.editingBlock = window.timeMatrix.blocks.length-1; updateEditors(); renderTrackBar(); });
    safeClick('btn-del-block', () => { if(confirm("Del?")) { window.timeMatrix.removeBlock(AppState.editingBlock); AppState.editingBlock = Math.max(0, window.timeMatrix.blocks.length-1); updateEditors(); renderTrackBar(); }});
    // COPY / PASTE
    safeClick('btn-mem-copy', () => { 
        if(window.timeMatrix.copyToClipboard(AppState.editingBlock)) {
            window.logToScreen("PATTERN COPIED");
        }
    });
    safeClick('btn-mem-paste', () => {
        if(window.timeMatrix.pasteFromClipboard(AppState.editingBlock)) {
            AppState.editingBlock++; // Seleccionar el nuevo bloque pegado
            updateEditors(); 
            renderTrackBar();
            window.logToScreen("PATTERN PASTED");
        } else {
             window.logToScreen("CLIPBOARD EMPTY", 'error');
        }
    });

    safeClick('btn-move-left', () => { if(window.timeMatrix.moveBlock(AppState.editingBlock, -1)) { AppState.editingBlock--; updateEditors(); renderTrackBar(); }});
    safeClick('btn-move-right', () => { if(window.timeMatrix.moveBlock(AppState.editingBlock, 1)) { AppState.editingBlock++; updateEditors(); renderTrackBar(); }});

    // Export
    safeClick('btn-open-export', () => { toggleMenu(); toggleExportModal(); });
    safeClick('btn-close-export', toggleExportModal);
    safeClick('btn-start-render', renderAudio);
    
    document.querySelectorAll('.export-rep-btn').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('.export-rep-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            AppState.exportReps = parseInt(btn.dataset.rep);
        };
    });
    
    // Matrix Tap
    window.addEventListener('stepSelect', (e) => {
        AppState.selectedStep = e.detail.index;
        updateEditors();
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
            // Default: no slide, no accent
            const prev = b.tracks[s.id][AppState.selectedStep];
            b.tracks[s.id][AppState.selectedStep] = { 
                note, 
                octave: AppState.currentOctave,
                slide: prev ? prev.slide : false,
                accent: prev ? prev.accent : false
            };
            s.play(note, AppState.currentOctave, audioCtx.currentTime);
            updateEditors();
        };
    });
    
    safeClick('btn-delete-note', () => {
        const s = bassSynths.find(sy => sy.id === AppState.activeView);
        if(s) { window.timeMatrix.blocks[AppState.editingBlock].tracks[s.id][AppState.selectedStep] = null; updateEditors(); }
    });

    // TOGGLE MODIFIERS
    const toggleNoteMod = (prop) => {
        if(AppState.activeView === 'drum') return;
        const b = window.timeMatrix.blocks[AppState.editingBlock];
        const track = b.tracks[AppState.activeView];
        if(!track) return;
        const note = track[AppState.selectedStep];
        if(note) {
            note[prop] = !note[prop];
            updateEditors();
        }
    };
    safeClick('btn-toggle-slide', () => toggleNoteMod('slide'));
    safeClick('btn-toggle-accent', () => toggleNoteMod('accent'));
    
    const bpm = document.getElementById('bpm-input');
    if(bpm) bpm.onchange = (e) => AppState.bpm = e.target.value;
    
    const octD = document.getElementById('oct-display');
    safeClick('oct-up', () => { if(AppState.currentOctave<6) AppState.currentOctave++; octD.innerText=AppState.currentOctave; });
    safeClick('oct-down', () => { if(AppState.currentOctave>1) AppState.currentOctave--; octD.innerText=AppState.currentOctave; });
    
    // ANALOG SLIDERS LOGIC
    const handleSlider = (id, prop) => {
        const el = document.getElementById(id);
        if(el) el.oninput = (e) => {
            const v = parseInt(e.target.value);
            const s = bassSynths.find(sy => sy.id === AppState.activeView);
            if(s) {
                if(prop === 'distortion') s.setDistortion(v);
                if(prop === 'cutoff') s.setCutoff(v);
                if(prop === 'resonance') s.setResonance(v);
                syncControlsFromSynth(AppState.activeView);
            }
        };
    };
    handleSlider('dist-slider', 'distortion');
    handleSlider('cutoff-slider', 'cutoff');
    handleSlider('res-slider', 'resonance');

    // DIGITAL INPUTS LOGIC
    const handleDigital = (id, prop) => {
        const el = document.getElementById(id);
        if(el) el.onchange = (e) => {
            let val = parseInt(e.target.value);
            val = Math.max(0, Math.min(100, val));
            e.target.value = val;

            const s = bassSynths.find(sy => sy.id === AppState.activeView);
            if(s) {
                if(prop === 'distortion') s.setDistortion(val);
                if(prop === 'cutoff') {
                    const freq = Math.floor((val / 100) * 4900) + 100;
                    s.setCutoff(freq);
                }
                if(prop === 'resonance') {
                    const res = val / 5;
                    s.setResonance(res);
                }
                syncControlsFromSynth(AppState.activeView);
            }
        };
    };
    handleDigital('dist-digital', 'distortion');
    handleDigital('cutoff-digital', 'cutoff');
    handleDigital('res-digital', 'resonance');
});