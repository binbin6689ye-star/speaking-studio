// Runs the Whisper speech model on the phone itself (no internet, no Google), so scoring works anywhere.
import { pipeline, env } from "./vendor/transformers.min.js";

env.allowLocalModels = true;          // load the model from this app's own files
env.allowRemoteModels = false;        // never call huggingface.co (blocked in some regions)
env.localModelPath = "./models/";
env.backends.onnx.wasm.wasmPaths = { mjs: new URL("./vendor/ort-wasm-simd-threaded.mjs", self.location.href).href, wasm: new URL("./vendor/ort-wasm-simd-threaded.wasm", self.location.href).href };  // the speech engine's WebAssembly files, also bundled
env.backends.onnx.wasm.numThreads = 1;           // phones without cross-origin isolation run single-threaded

let asr = null, loading = null, modelName = "Xenova/whisper-tiny.en";

function load() {
  if (!loading) {
    loading = pipeline("automatic-speech-recognition", modelName, {
      dtype: "q8",
      device: "wasm",
      progress_callback: p => {
        if (p.status === "progress" && p.total) postMessage({ type: "progress", file: p.file, loaded: p.loaded, total: p.total });
      }
    }).then(p => { asr = p; postMessage({ type: "ready" }); return p; })
      .catch(err => { loading = null; postMessage({ type: "error", message: String(err && err.message || err) }); throw err; });
  }
  return loading;
}

self.onmessage = async e => {
  const msg = e.data;
  if (msg.type === "load") { if (msg.model) modelName = msg.model; load().catch(() => {}); return; }
  if (msg.type === "run") {
    try {
      await load();
      const out = await asr(msg.audio);
      postMessage({ type: "result", id: msg.id, text: (out && out.text || "").trim() });
    } catch (err) {
      postMessage({ type: "result", id: msg.id, text: "", error: String(err && err.message || err) });
    }
  }
};
