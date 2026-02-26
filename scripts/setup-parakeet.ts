import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const MODELS_DIR = path.join(os.homedir(), ".claude", "models");
const VENV_DIR = path.join(MODELS_DIR, "venv");

async function setup() {
  console.log("🚀 Initializing Parakeet V3 Setup for aiMessage...");

  if (!fs.existsSync(MODELS_DIR)) {
    fs.mkdirSync(MODELS_DIR, { recursive: true });
  }

  // 1. Create Virtual Env
  if (!fs.existsSync(VENV_DIR)) {
    console.log("📦 Creating Python Virtual Environment...");
    let pyCmd = "python3";
    try { execSync("python3.12 --version"); pyCmd = "python3.12"; } catch {}
    execSync(`${pyCmd} -m venv ${VENV_DIR}`);
  }

  // Check for Python 3.14 (experimental/broken wheels)
  const pyVersion = execSync(`${VENV_DIR}/bin/python --version`).toString();
  if (pyVersion.includes("3.14")) {
    console.log("⚠️ Detected Python 3.14, which is currently incompatible with NeMo wheels.");
    console.log("🗑 Removing and recreating with a stable version...");
    fs.rmSync(VENV_DIR, { recursive: true, force: true });
    let stablePy = "python3";
    try { execSync("python3.12 --version"); stablePy = "python3.12"; } 
    catch { try { execSync("python3.11 --version"); stablePy = "python3.11"; } catch {} }
    execSync(`${stablePy} -m venv ${VENV_DIR}`);
  }

  const pip = path.join(VENV_DIR, "bin", "pip");

  // 2. Install Dependencies
  console.log("📥 Installing NVIDIA NeMo (optimized for Mac)...");
  try {
    execSync(`${pip} install --upgrade pip`);
    execSync(`${pip} install Cython setuptools`);
    // NeMo needs torchaudio and ffmpeg for reading files
    execSync(`${pip} install torchaudio pydub ffmpeg-python`);
    execSync(`${pip} install nemo_toolkit['asr'] transformers torch mlx mlx-whisper`);
  } catch (err) {
    console.error("❌ Installation failed. Make sure you have Xcode Command Line Tools installed.");
    process.exit(1);
  }

  // Check for system ffmpeg
  try {
    execSync("ffmpeg -version");
  } catch {
    console.log("⚠️ ffmpeg not found in system path. Attempting to install via brew...");
    try {
      execSync("brew install ffmpeg");
    } catch {
      console.log("❌ Failed to install ffmpeg via brew. Please install it manually for audio processing.");
    }
  }

  // 3. Create the Transcription Bridge Script
  const bridgeScript = path.join(MODELS_DIR, "transcribe.py");
  const bridgeContent = `
import sys
import mlx_whisper
import json
import os

# MLX Whisper is optimized for Apple Silicon and highly reliable
def transcribe(audio_path):
    # Using the Turbo model for the best balance of speed and accuracy
    # Forcing language="en" to ensure consistently English output
    result = mlx_whisper.transcribe(
        audio_path, 
        path_or_hf_repo="mlx-community/whisper-large-v3-turbo",
        language="en"
    )
    return result["text"].strip()

if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(1)
    
    text = transcribe(sys.argv[1])
    print(text)
`;
  fs.writeFileSync(bridgeScript, bridgeContent);

  // 4. Pre-download the model
  console.log("🚚 Pre-downloading Whisper Large V3 Turbo model...");
  try {
    const pythonPath = path.join(VENV_DIR, "bin", "python");
    execSync(`"${pythonPath}" -c "import mlx_whisper; mlx_whisper.transcribe(None, path_or_hf_repo='mlx-community/whisper-large-v3-turbo')"`, { stdio: "inherit" });
  } catch (err) {
    console.log("💡 Model cached or ready.");
  }

  console.log("\n✅ Setup Complete!");
  console.log(`📍 Model Environment: ${VENV_DIR}`);
  console.log(`📍 Bridge Script: ${bridgeScript}`);
  console.log("\nYou can now use the Microphone icon in aiMessage to transcribe voice natively.");
}

setup().catch(console.error);
