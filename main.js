/*
 * NEURODARK MAIN CONTROLLER v19 (Render Edition)
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

// --- EXPORT AUDIO LOGIC ---
async function renderAudio() {
    if(AppState.isPlaying) toggleTransport(); // Stop playback
    
    window.logToScreen("Starting Offline Render...", "info");
    const btnRender = document.getElementById('btn-start-render');
    btnRender.innerText = "RENDERING...";
    btnRender.disabled = true;

    try {
        // 1. Calculate Duration
        const stepsPerBlock = window.timeMatrix.totalSteps;
        const totalBlocks = window.timeMatrix.blocks.length;
        const secondsPerBeat = 60.0 / AppState.bpm;
        const secondsPerStep = secondsPerBeat / 4;
        const totalSteps = stepsPerBlock * totalBlocks * AppState.exportReps;
        const totalDuration = totalSteps * secondsPerStep + 2.0; // 2s tail for reverb/delay

        // 2. Setup Offline Context
        const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        const offlineCtx = new OfflineCtx(2, 44100 * totalDuration, 44100);
        
        // 3. Recreate Synth Chain
        const offMaster = offlineCtx.createGain();
        offMaster.gain.value = 0.6;
        const comp = offlineCtx.createDynamicsCompressor();
        comp.threshold.value = -3;
        offMaster.connect(comp);
        comp.connect(offlineCtx.destination);

        // Instantiate OFF-SCREEN synths
        const offBassSynths = [];
        bassSynths.forEach(liveSynth => {
            const s = new window.BassSynth(liveSynth.id);
            s.init(offlineCtx, offMaster);
            s.setDistortion(liveSynth.params.distortion); // Copy params
            offBassSynths.push(s);
        });

        const offDrumSynth = new DrumSynth(); // Assumes global DrumSynth class
        offDrumSynth.init(offlineCtx, offMaster);

        // 4. Scheduling Loop
        window.logToScreen(`Scheduling ${totalSteps} steps...`);
        
        let currentTime = 0.0;
        
        for (let r = 0; r < AppState.exportReps; r++) {
            for (let b = 0; b < totalBlocks; b++) {
                const block = window.timeMatrix.blocks[b];
                
                for (let s = 0; s < stepsPerBlock; s++) {
                    // Drums
                    const drums = block.drums[s];
                    if (drums) drums.forEach(id => offDrumSynth.play(id, currentTime));

                    // Bass
                    Object.keys(block.tracks).forEach(tid => {
                        const noteData = block.tracks[tid][s];
                        if (noteData) {
                            const synth = offBassSynths.find(sy => sy.id === tid);
                            if (synth) synth.play(noteData.note, noteData.octave, currentTime, 0.25);
                        }
                    });

                    currentTime += secondsPerStep;
                }
            }
        }

        // 5. Render
        window.logToScreen("Rendering Audio Buffer...");
        const renderedBuffer = await offlineCtx.startRendering();
        
        // 6. Encode to WAV (Simple Helper)
        window.logToScreen("Encoding WAV...");
        const wavBlob = bufferToWave(renderedBuffer, renderedBuffer.length);
        const url = URL.createObjectURL(wavBlob);
        
        // 7. Download
        const a = document.createElement('a');
        a.href = url;
        a.download = `NeuroDark_Sequence_${Date.now()}.wav`;
        a.click();
        
        window.logToScreen("Export Complete!", "success");
        toggleExportModal(); // Close modal

    } catch (e) {
        window.logToScreen("Render Failed: " + e, "error");
        console.error(e);
    } finally {
        btnRender.innerText = "START RENDER";
        btnRender.disabled = false;
    }
}

// WAV Encoder Helper
function bufferToWave(abuffer, len) {
    let numOfChan = abuffer.numberOfChannels,
        length = len * numOfChan * 2 + 44,
        buffer = new ArrayBuffer(length),
        view = new DataView(buffer),
        channels = [], i, sample,
        offset = 0,
        pos = 0;

    // write WAVE header
    setUint32(0x46464952); // "RIFF"
    setUint32(length - 8); // file length - 8
    setUint32(0x45564157); // "WAVE"

    setUint32(0x20746d66); // "fmt " chunk
    setUint32(16); // length = 16
    setUint16(1); // PCM (uncompressed)
    setUint16(numOfChan);
    setUint32(abuffer.sampleRate);
    setUint32(abuffer.sampleRate * 2 * numOfChan); // avg. bytes/sec
    setUint16(numOfChan * 2); // block-align
    setUint16(16); // 16-bit (hardcoded in this prototype)

    setUint32(0x61746164); // "data" - chunk
    setUint32(length - pos - 4); // chunk length

    for(i = 0; i < numOfChan; i++) channels.push(abuffer.getChannelData(i));

    while(pos < length) {
        for(i = 0; i < numOfChan; i++) {
            sample = Math.max(-1, Math.min(1, channels[i][offset])); 
            sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767)|0; 
            view.setInt16(pos, sample, true); 
            pos += 2;
        }
        offset++;
    }

    return new Blob([buffer], {type: "audio/wav"});

    function setUint16(data) { view.setUint16(pos, data, true); pos += 2; }
    function setUint32(data) { view.setUint32(pos, data, true); pos += 4; }
}

// --- BOOTSTRAP ---
function bootstrap() {
    window.logToScreen("Init...");
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
        btn.innerHTML = "&#10074;&#10074;"; btn.classList.add('border-green-500', 'text-green-500');
        AppState.currentPlayStep = 0; AppState.currentPlayBlock = AppState.editingBlock;
        nextNoteTime = audioCtx.currentTime + 0.1; visualQueue = [];
        if(clockWorker) clockWorker.postMessage("start");
        drawLoop();
        window.logToScreen("PLAY");
    } else {
        btn.innerHTML = "&#9658;"; btn.classList.remove('border-green-500', 'text-green-500');
        if(clockWorker) clockWorker.postMessage("stop");
        cancelAnimationFrame(drawFrameId); window.timeMatrix.highlightPlayingStep(-1); updatePlayClock(-1);
        renderTrackBar(); window.logToScreen("STOP");
    }
}

// --- MODALS ---
function toggleMenu() { document.getElementById('main-menu').classList.toggle('hidden'); document.getElementById('main-menu').classList.toggle('flex'); }
function toggleExportModal() { document.getElementById('export-modal').classList.toggle('hidden'); document.getElementById('export-modal').classList.toggle('flex'); }

// --- SETUP ---
document.addEventListener('DOMContentLoaded', () => {
    bootstrap();
    
    document.addEventListener('click', globalUnlock);
    document.addEventListener('touchstart', globalUnlock);
    document.getElementById('btn-play').onclick = toggleTransport;
    
    // Menus
    document.getElementById('btn-open-menu').onclick = () => { renderSynthMenu(); toggleMenu(); };
    document.getElementById('btn-menu-close').onclick = toggleMenu;
    document.getElementById('btn-open-export').onclick = () => { toggleMenu(); toggleExportModal(); }; // Close main, open export
    document.getElementById('btn-close-export').onclick = toggleExportModal;
    document.getElementById('btn-start-render').onclick = renderAudio;

    // Export Reps
    document.querySelectorAll('.export-rep-btn').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('.export-rep-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            AppState.exportReps = parseInt(btn.dataset.rep);
        };
    });

    // Log Panel
    const logPanel = document.getElementById('sys-log-panel');
    const logToggle = document.getElementById('btn-toggle-log-internal');
    const toggleLog = () => {
        if(logPanel.style.transform === 'translateY(-100%)') { logPanel.style.transform = 'translateY(0)'; logToggle.innerText = "[HIDE]"; }
        else { logPanel.style.transform = 'translateY(-100%)'; logToggle.innerText = "[SHOW]"; }
    };
    logToggle.onclick = toggleLog;
    document.getElementById('btn-toggle-log-menu').onclick = () => { toggleLog(); toggleMenu(); };

    // Synth
    document.getElementById('btn-add-synth').onclick = addBassSynth;
    document.getElementById('btn-menu-panic').onclick = () => location.reload();
    document.getElementById('btn-menu-clear').onclick = () => { if(confirm("Clear?")) { window.timeMatrix.clearBlock(AppState.editingBlock); updateEditors(); toggleMenu(); }};
    
    // Track Advanced Controls
    document.getElementById('btn-add-block').onclick = () => { window.timeMatrix.addBlock(); AppState.editingBlock = window.timeMatrix.blocks.length-1; updateEditors(); renderTrackBar(); };
    document.getElementById('btn-del-block').onclick = () => { if(confirm("Del?")) { window.timeMatrix.removeBlock(AppState.editingBlock); AppState.editingBlock = Math.max(0, window.timeMatrix.blocks.length-1); updateEditors(); renderTrackBar(); }};
    document.getElementById('btn-copy-block').onclick = () => { window.timeMatrix.duplicateBlock(AppState.editingBlock); AppState.editingBlock++; updateEditors(); renderTrackBar(); };
    document.getElementById('btn-move-left').onclick = () => { 
        if(window.timeMatrix.moveBlock(AppState.editingBlock, -1)) { AppState.editingBlock--; updateEditors(); renderTrackBar(); } 
    };
    document.getElementById('btn-move-right').onclick = () => { 
        if(window.timeMatrix.moveBlock(AppState.editingBlock, 1)) { AppState.editingBlock++; updateEditors(); renderTrackBar(); } 
    };

    // Dock
    document.getElementById('btn-dock-mode').onclick = () => {
        const p = document.getElementById('editor-panel');
        p.classList.toggle('panel-docked'); p.classList.toggle('panel-overlay');
        const ph = document.getElementById('dock-placeholder');
        const btn = document.getElementById('btn-dock-mode');
        if(p.classList.contains('panel-docked')) { ph.appendChild(p); btn.innerHTML = "&#9633;"; } 
        else { document.body.appendChild(p); btn.innerHTML = "_"; }
    };
    
    // Interactions
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
    
    document.getElementById('bpm-input').onchange = (e) => AppState.bpm = e.target.value;
    const octD = document.getElementById('oct-display');
    document.getElementById('oct-up').onclick = () => { if(AppState.currentOctave<6) AppState.currentOctave++; octD.innerText=AppState.currentOctave; };
    document.getElementById('oct-down').onclick = () => { if(AppState.currentOctave>1) AppState.currentOctave--; octD.innerText=AppState.currentOctave; };
    document.getElementById('dist-slider').oninput = (e) => {
        const v = parseInt(e.target.value);
        const s = bassSynths.find(sy => sy.id === AppState.activeView);
        if(s) s.setDistortion(v);
    };
    
    // Safe icon init (Using Unpkg now, so we assume Lucide global exists or will exist)
    if(typeof lucide !== 'undefined') lucide.createIcons();
});